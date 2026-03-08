/**
 * Worker-specific Torn API service with per-user rate limiting.
 * Uses the global @sentinel/shared TornApiClient with per-user rate limiter.
 *
 * Key difference from old system:
 * - Tracks rate limits per USER (not per API key)
 * - Respects Torn's actual limit: 100 req/min per user across all their keys
 * - Supports batch operations with smart key distribution
 * - Auto-marks invalid keys (error code 2) after multiple failures to prevent IP blocking
 */

import {
  TornApiClient,
  BatchOperationHandler,
  ApiKeyRotator,
  TABLE_NAMES,
  hashApiKey,
} from "@sentinel/shared";
import { markSystemApiKeyInvalid } from "../lib/system-api-keys.js";
import { getAllSystemApiKeys, getSystemApiKey } from "../lib/api-keys.js";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import {
  getOldestRequestPerUser,
  getRequestCountPerUser,
  recordRequestPerUser,
} from "../lib/rate-limit-tracker-per-user.js";

const API_KEY_HASH_PEPPER = process.env.API_KEY_HASH_PEPPER!;

if (!API_KEY_HASH_PEPPER) {
  throw new Error("API_KEY_HASH_PEPPER environment variable is required");
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 50;

class WorkerSqliteRateLimiter {
  async waitIfNeeded(apiKey: string): Promise<void> {
    const count = await getRequestCountPerUser(apiKey);

    if (count >= MAX_REQUESTS_PER_WINDOW) {
      const oldestRequest = await getOldestRequestPerUser(apiKey);
      if (oldestRequest) {
        const age = Date.now() - oldestRequest.getTime();
        const waitTime = WINDOW_MS - age + 100;
        if (waitTime > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          return this.waitIfNeeded(apiKey);
        }
      }
    }
  }

  async recordRequest(apiKey: string): Promise<void> {
    await recordRequestPerUser(apiKey);
  }

  async getRequestCount(apiKey: string): Promise<number> {
    return getRequestCountPerUser(apiKey);
  }

  getMaxRequests(): number {
    return MAX_REQUESTS_PER_WINDOW;
  }

  clearCache(): void {
    // No-op for SQLite tracker.
  }
}

/**
 * Global per-user rate limiter instance for worker
 * This tracks requests per USER across all their API keys
 */
const rateLimiter = new WorkerSqliteRateLimiter();

/**
 * Global Torn API client instance with per-user rate limiting
 * and invalid key auto-deletion (only on error code 2)
 */
export const tornApi = new TornApiClient({
  rateLimitTracker: rateLimiter,
  onInvalidKey: async (apiKey: string) => {
    console.warn(
      `Invalid API key detected (error code 2), marking for deletion`,
    );
    await markSystemApiKeyInvalid(apiKey, 3); // Soft-delete after 3 failures
  },
});

/**
 * Global batch operation handler for distributing requests optimally
 */
export const batchHandler = new BatchOperationHandler(rateLimiter);

/**
 * Clear stale rate limit entries on startup
 * Completely wipes the rate limit table to give a clean slate
 * This prevents false rate limiting from entries recorded in previous runs
 */
async function clearStaleRateLimitData(_userIds: number[]): Promise<void> {
  try {
    const db = getKysely();

    // Get count before delete
    const beforeCountRow = await db
      .selectFrom(TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER)
      .select((eb) => eb.fn.count("id").as("count"))
      .executeTakeFirst();
    const beforeCount = Number(beforeCountRow?.count ?? 0);

    // Delete ALL rate limit entries (not just for specific users)
    // On startup, we want a completely clean slate to prevent false positives
    // from requests recorded before the worker was stopped
    await db
      .deleteFrom(TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER)
      .where("requested_at", ">=", "1970-01-01T00:00:00Z")
      .execute(); // Delete all entries (gte oldest possible date)

    // Verify cleanup
    const afterCountRow = await db
      .selectFrom(TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER)
      .select((eb) => eb.fn.count("id").as("count"))
      .executeTakeFirst();
    const afterCount = Number(afterCountRow?.count ?? 0);

    console.log(
      `[TornClient] ✓ Rate limit table cleared (${(beforeCount || 0) - (afterCount || 0)} entries)`,
    );
  } catch (error) {
    console.warn(
      `[TornClient] Warning: Unexpected error during rate limit cleanup:`,
      error instanceof Error ? error.message : String(error),
    );
    // Don't throw - this is not critical enough to block startup
  }

  // Clear the rate limiter's cache after cleanup
  rateLimiter.clearCache();
}

async function ensureApiKeyMappedInSqlite(
  apiKey: string,
): Promise<{ userId: number | null; error: string | null }> {
  const db = getKysely();
  const keyHash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);

  try {
    const existing = await db
      .selectFrom(TABLE_NAMES.API_KEY_USER_MAPPING)
      .select("user_id")
      .where("api_key_hash", "=", keyHash)
      .where("deleted_at", "is", null)
      .limit(1)
      .executeTakeFirst();

    if (existing?.user_id) {
      return { userId: Number(existing.user_id), error: null };
    }

    const client = new TornApiClient();
    const data = await client.get("/user/basic", { apiKey });
    const userId = data.profile?.id;

    if (!userId) {
      return { userId: null, error: "No player_id in Torn API response" };
    }

    await db
      .insertInto(TABLE_NAMES.API_KEY_USER_MAPPING)
      .values({
        api_key_hash: keyHash,
        user_id: userId,
        source: "system",
        created_at: new Date().toISOString(),
        deleted_at: null,
      })
      .onConflict((oc) =>
        oc.column("api_key_hash").doUpdateSet({
          user_id: userId,
          source: "system",
          deleted_at: null,
        }),
      )
      .execute();

    return { userId, error: null };
  } catch (error) {
    return {
      userId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Ensure system API key is mapped to user for rate limiting
 * CRITICAL: This must succeed before any API calls are made
 * Throws error if mapping cannot be created - rate limiting is non-negotiable
 */
export async function initializeApiKeyMappings(
  scope: "private" | "public" | "all" = "all",
): Promise<number[]> {
  const keysToMap: string[] = [];

  if (scope === "private") {
    const personalKey = await getSystemApiKey("personal");
    keysToMap.push(personalKey);
  }

  if (scope === "public") {
    const pooledKeys = await getAllSystemApiKeys("system");
    if (!pooledKeys.length) {
      throw new Error(
        "[CRITICAL] No system API keys available. Add system keys to sentinel_system_api_keys to start public workers.",
      );
    }
    keysToMap.push(...pooledKeys);
  }

  if (scope === "all") {
    const personalKey = await getSystemApiKey("personal");
    const pooledKeys = await getAllSystemApiKeys("system");
    keysToMap.push(personalKey, ...pooledKeys);
  }

  const uniqueKeys = Array.from(new Set(keysToMap));

  if (!uniqueKeys.length) {
    throw new Error(
      "[CRITICAL] No API keys available for rate limiting initialization.",
    );
  }

  console.log("[TornClient] Attempting to initialize API key mappings...");
  const mappedUserIds: number[] = [];

  for (const apiKey of uniqueKeys) {
    const result = await ensureApiKeyMappedInSqlite(apiKey);

    if (!result.userId) {
      const detailedError = result.error || "Unknown error";
      throw new Error(
        "[CRITICAL] Failed to map API key to user. Rate limiting cannot be initialized.\n" +
          `Error Details: ${detailedError}\n` +
          "Verify the API key is valid and your SQLite database is available. " +
          "Without working rate limiting, your API keys will be blocked.",
      );
    }

    mappedUserIds.push(result.userId);
  }

  console.log(
    `[TornClient] ✓ Mapped ${mappedUserIds.length} API key(s) for rate limiting initialization`,
  );

  // Clear stale rate limit data from previous runs
  // This prevents false rate limiting when the worker restarts
  await clearStaleRateLimitData(mappedUserIds);

  return mappedUserIds;
}

export async function initializeApiKeyMapping(): Promise<number> {
  const [userId] = await initializeApiKeyMappings("all");
  return userId ?? 0;
}

/**
 * Export utilities for use in workers
 */
export { ApiKeyRotator, BatchOperationHandler };
