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
import { getDB } from "@sentinel/shared/db/sqlite.js";
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
    const db = getDB();

    // Get count before delete
    const beforeCount = (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM "${TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER}"`,
        )
        .get() as { count: number }
    ).count;

    // Delete ALL rate limit entries (not just for specific users)
    // On startup, we want a completely clean slate to prevent false positives
    // from requests recorded before the worker was stopped
    db.prepare(
      `DELETE FROM "${TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER}" WHERE requested_at >= ?`,
    ).run("1970-01-01T00:00:00Z"); // Delete all entries (gte oldest possible date)

    // Verify cleanup
    const afterCount = (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM "${TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER}"`,
        )
        .get() as { count: number }
    ).count;

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
  const db = getDB();
  const keyHash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);

  try {
    const existing = db
      .prepare(
        `SELECT user_id
         FROM "${TABLE_NAMES.API_KEY_USER_MAPPING}"
         WHERE api_key_hash = ?
           AND deleted_at IS NULL
         LIMIT 1`,
      )
      .get(keyHash) as { user_id: number } | undefined;

    if (existing?.user_id) {
      return { userId: Number(existing.user_id), error: null };
    }

    const client = new TornApiClient();
    const data = await client.get("/user/basic", { apiKey });
    const userId = data.profile?.id;

    if (!userId) {
      return { userId: null, error: "No player_id in Torn API response" };
    }

    db.prepare(
      `INSERT INTO "${TABLE_NAMES.API_KEY_USER_MAPPING}" (api_key_hash, user_id, source, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(api_key_hash) DO UPDATE SET
         user_id = excluded.user_id,
         source = excluded.source,
         deleted_at = NULL`,
    ).run(keyHash, userId, "system", new Date().toISOString());

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
