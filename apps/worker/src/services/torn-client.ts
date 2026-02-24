/**
 * Worker-specific Torn API service with per-user rate limiting.
 * Uses the global @sentinel/shared TornApiClient with per-user rate limiter.
 *
 * Key difference from old system:
 * - Tracks rate limits per USER (not per API key)
 * - Respects Torn's actual limit: 100 req/min per user across all their keys
 * - Supports batch operations with smart key distribution
 * - Auto-marks invalid keys after multiple failures to prevent IP blocking
 */

import {
  TornApiClient,
  PerUserRateLimiter,
  BatchOperationHandler,
  ApiKeyRotator,
  TABLE_NAMES,
  ensureApiKeyMapped,
} from "@sentinel/shared";
import { supabase } from "../lib/supabase.js";
import { markSystemApiKeyInvalid } from "../lib/system-api-keys.js";
import { getAllSystemApiKeys, getSystemApiKey } from "../lib/api-keys.js";

const API_KEY_HASH_PEPPER = process.env.API_KEY_HASH_PEPPER!;

if (!API_KEY_HASH_PEPPER) {
  throw new Error("API_KEY_HASH_PEPPER environment variable is required");
}

/**
 * Global per-user rate limiter instance for worker
 * This tracks requests per USER across all their API keys
 */
const rateLimiter = new PerUserRateLimiter({
  supabase,
  tableName: TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER,
  apiKeyMappingTableName: TABLE_NAMES.API_KEY_USER_MAPPING,
  hashPepper: API_KEY_HASH_PEPPER,
  // Uses RATE_LIMITING.MAX_REQUESTS_PER_MINUTE from constants (50 req/min per user)
});

/**
 * Global Torn API client instance with per-user rate limiting
 * and invalid key auto-deletion
 */
export const tornApi = new TornApiClient({
  rateLimitTracker: rateLimiter,
  onInvalidKey: async (apiKey, errorCode) => {
    console.warn(
      `Invalid API key detected (error code ${errorCode}), marking for deletion`,
    );
    await markSystemApiKeyInvalid(apiKey, 3); // Soft-delete after 3 failures
  },
});

/**
 * Global batch operation handler for distributing requests optimally
 */
export const batchHandler = new BatchOperationHandler(rateLimiter);

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
    const pooledKeys = await getAllSystemApiKeys("all");
    if (!pooledKeys.length) {
      throw new Error(
        "[CRITICAL] No system API keys available. Add system keys to sentinel_system_api_keys to start public workers.",
      );
    }
    keysToMap.push(...pooledKeys);
  }

  if (scope === "all") {
    const personalKey = await getSystemApiKey("personal");
    const pooledKeys = await getAllSystemApiKeys("all");
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
    const result = await ensureApiKeyMapped(apiKey, supabase, {
      tableName: TABLE_NAMES.API_KEY_USER_MAPPING,
      hashPepper: API_KEY_HASH_PEPPER,
    });

    if (!result.userId) {
      const detailedError = result.error || "Unknown error";
      throw new Error(
        "[CRITICAL] Failed to map API key to user. Rate limiting cannot be initialized.\n" +
          `Error Details: ${detailedError}\n` +
          "Verify the API key is valid and your Supabase connection works. " +
          "Without working rate limiting, your API keys will be blocked.",
      );
    }

    mappedUserIds.push(result.userId);
  }

  console.log(
    `[TornClient] ✓ Mapped ${mappedUserIds.length} API key(s) for rate limiting initialization`,
  );

  return mappedUserIds;
}

export async function initializeApiKeyMapping(): Promise<number> {
  const [userId] = await initializeApiKeyMappings("all");
  return userId ?? 0;
}

/**
 * Export utilities for use in workers
 */
export { ApiKeyRotator, PerUserRateLimiter, BatchOperationHandler };
