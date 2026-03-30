/**
 * Per-user rate limit tracking using database.
 * Tracks API requests per API key to ensure no single key exceeds limits.
 * Persists across restarts and coordinates across multiple instances.
 */

import { createHash, randomUUID } from "crypto";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

const TRACKER_TABLE = TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER;
const API_KEY_USER_MAPPING_TABLE = TABLE_NAMES.API_KEY_USER_MAPPING;
const WINDOW_MS = 60000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 50; // Per-user limit: 50 req/min (Torn allows 100 per key, use 50 for safety)
const CLEANUP_INTERVAL_MS = 30000;
let lastCleanupAt = 0;

async function getMappedUserIdByApiKeyHash(keyHash: string): Promise<number> {
  const db = getKysely();
  const row = await db
    .selectFrom(API_KEY_USER_MAPPING_TABLE)
    .select("user_id")
    .where("api_key_hash", "=", keyHash)
    .limit(1)
    .executeTakeFirst();

  const parsed = Number(row?.user_id);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Hash API key for storage (don't store raw keys)
 * Uses a secret pepper for additional security
 */
function hashApiKey(apiKey: string): string {
  const pepper = process.env.API_KEY_HASH_PEPPER;
  if (!pepper) {
    throw new Error(
      "API_KEY_HASH_PEPPER environment variable is required for secure rate limiting",
    );
  }
  return createHash("sha256")
    .update(apiKey + pepper)
    .digest("hex");
}

/**
 * Record a new request for an API key
 */
export async function recordRequestPerUser(apiKey: string): Promise<void> {
  const keyHash = hashApiKey(apiKey);
  const now = new Date().toISOString();

  try {
    const db = getKysely();
    const userId = await getMappedUserIdByApiKeyHash(keyHash);

    await db
      .insertInto(TRACKER_TABLE)
      .values({
        id: randomUUID(),
        api_key_hash: keyHash,
        requested_at: now,
        user_id: userId || null,
      })
      .execute();
  } catch (error) {
    console.error("Failed to record per-user request:", error);
  }
}

/**
 * Get count of requests for an API key in the current window
 */
export async function getRequestCountPerUser(apiKey: string): Promise<number> {
  const keyHash = hashApiKey(apiKey);
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  try {
    const db = getKysely();
    const row = await db
      .selectFrom(TRACKER_TABLE)
      .select((eb) => eb.fn.count("id").as("count"))
      .where("api_key_hash", "=", keyHash)
      .where("requested_at", ">=", windowStart)
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Check if an API key is rate limited
 */
export async function isRateLimitedPerUser(apiKey: string): Promise<boolean> {
  const count = await getRequestCountPerUser(apiKey);
  return count >= MAX_REQUESTS_PER_WINDOW;
}

/**
 * Get oldest request timestamp for an API key in current window
 */
export async function getOldestRequestPerUser(
  apiKey: string,
): Promise<Date | null> {
  const keyHash = hashApiKey(apiKey);
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  try {
    const db = getKysely();
    const data = await db
      .selectFrom(TRACKER_TABLE)
      .select("requested_at")
      .where("api_key_hash", "=", keyHash)
      .where("requested_at", ">=", windowStart)
      .orderBy("requested_at", "asc")
      .limit(1)
      .executeTakeFirst();

    if (!data) {
      return null;
    }

    return new Date(data.requested_at);
  } catch {
    return null;
  }
}

/**
 * Clean up old request records for all keys (older than window)
 */
export async function cleanupOldRequestsPerUser(): Promise<void> {
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  try {
    const db = getKysely();
    await db
      .deleteFrom(TRACKER_TABLE)
      .where("requested_at", "<", windowStart)
      .execute();
  } catch (error) {
    console.error("Failed to cleanup per-user requests:", error);
  }
}

/**
 * Wait if necessary to ensure we don't exceed per-user rate limit.
 */
export async function waitIfNeededPerUser(apiKey: string): Promise<void> {
  const now = Date.now();
  if (now - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
    lastCleanupAt = now;
    cleanupOldRequestsPerUser().catch(() => {});
  }

  while (true) {
    const count = await getRequestCountPerUser(apiKey);
    if (count < MAX_REQUESTS_PER_WINDOW) {
      await recordRequestPerUser(apiKey);
      return;
    }

    const oldestRequest = await getOldestRequestPerUser(apiKey);
    if (!oldestRequest) {
      await recordRequestPerUser(apiKey);
      return;
    }

    const age = Date.now() - oldestRequest.getTime();
    const waitTime = WINDOW_MS - age + 100; // +100ms buffer
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      continue;
    }

    await recordRequestPerUser(apiKey);
    return;
  }
}
