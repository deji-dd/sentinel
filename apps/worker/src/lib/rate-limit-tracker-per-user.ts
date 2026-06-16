/**
 * Per-user rate limit tracking using memory RAM Map and SQLite write-behind.
 * Tracks API requests per API key to ensure no single key exceeds limits.
 * Decouples SQLite reads and writes from the active API execution path.
 */

import { createHash, randomUUID } from "crypto";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

const TRACKER_TABLE = TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER;
const API_KEY_USER_MAPPING_TABLE = TABLE_NAMES.API_KEY_USER_MAPPING;
const WINDOW_MS = 60000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 50; // Per-user limit: 50 req/min
const CLEANUP_INTERVAL_MS = 30000;
let lastCleanupAt = 0;

// Global in-memory cache for rate limiting: api_key_hash -> Array of timestamps (ms)
const ramMap = new Map<string, number[]>();

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
 * Initialize the RAM cache with active rate-limit records from SQLite.
 * This should be called once on worker startup.
 */
export async function initializeRateLimitCache(): Promise<void> {
  const db = getKysely();
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  try {
    const rows = await db
      .selectFrom(TRACKER_TABLE)
      .select(["api_key_hash", "requested_at"])
      .where("requested_at", ">=", windowStart)
      .execute();

    let recordCount = 0;
    for (const row of rows) {
      const time = new Date(row.requested_at).getTime();
      const existing = ramMap.get(row.api_key_hash) || [];
      existing.push(time);
      existing.sort((a, b) => a - b);
      ramMap.set(row.api_key_hash, existing);
      recordCount += 1;
    }

    console.log(
      `[RateLimitCache] Initialized RAM cache with ${recordCount} active records for ${ramMap.size} keys.`,
    );
  } catch (error) {
    console.error("Failed to initialize rate limit cache:", error);
  }
}

/**
 * Record a new request for an API key in-memory, and perform write-behind to SQLite.
 */
export async function recordRequestPerUser(apiKey: string): Promise<void> {
  const keyHash = hashApiKey(apiKey);
  const now = Date.now();

  // 1. Update in-memory RAM cache instantly
  const timestamps = ramMap.get(keyHash) || [];
  timestamps.push(now);
  ramMap.set(keyHash, timestamps);

  // 2. Perform background write-behind to SQLite (non-blocking)
  getMappedUserIdByApiKeyHash(keyHash)
    .then((userId) => {
      const db = getKysely();
      return db
        .insertInto(TRACKER_TABLE)
        .values({
          id: randomUUID(),
          api_key_hash: keyHash,
          requested_at: new Date(now).toISOString(),
          user_id: userId || null,
        })
        .execute();
    })
    .catch((error) => {
      console.error(
        "Failed to write-behind rate limit request to SQLite:",
        error,
      );
    });
}

/**
 * Get count of requests for an API key in the current window (memory-only)
 */
export async function getRequestCountPerUser(apiKey: string): Promise<number> {
  const keyHash = hashApiKey(apiKey);
  const now = Date.now();
  const timestamps = ramMap.get(keyHash) || [];

  const active = timestamps.filter((t) => t >= now - WINDOW_MS);
  if (active.length !== timestamps.length) {
    ramMap.set(keyHash, active);
  }

  return active.length;
}

/**
 * Check if an API key is rate limited (memory-only)
 */
export async function isRateLimitedPerUser(apiKey: string): Promise<boolean> {
  const count = await getRequestCountPerUser(apiKey);
  return count >= MAX_REQUESTS_PER_WINDOW;
}

/**
 * Get oldest request timestamp for an API key in current window (memory-only)
 */
export async function getOldestRequestPerUser(
  apiKey: string,
): Promise<Date | null> {
  const keyHash = hashApiKey(apiKey);
  const now = Date.now();
  const timestamps = ramMap.get(keyHash) || [];

  const active = timestamps.filter((t) => t >= now - WINDOW_MS);
  if (active.length === 0) {
    return null;
  }

  return new Date(active[0]);
}

/**
 * Clean up old request records in RAM, and prune the SQLite table in the background.
 */
export async function cleanupOldRequestsPerUser(): Promise<void> {
  const now = Date.now();

  // 1. Clean RAM cache
  for (const [keyHash, timestamps] of ramMap.entries()) {
    const active = timestamps.filter((t) => t >= now - WINDOW_MS);
    if (active.length === 0) {
      ramMap.delete(keyHash);
    } else if (active.length !== timestamps.length) {
      ramMap.set(keyHash, active);
    }
  }

  // 2. Perform background DB cleanup
  const windowStart = new Date(now - WINDOW_MS).toISOString();
  try {
    const db = getKysely();
    await db
      .deleteFrom(TRACKER_TABLE)
      .where("requested_at", "<", windowStart)
      .execute();
  } catch (error) {
    console.error("Failed to cleanup old database rate limit requests:", error);
  }
}

/**
 * Wait if necessary to ensure we don't exceed per-user rate limit.
 * Uses local memory lookups and non-blocking cleanup calls.
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
