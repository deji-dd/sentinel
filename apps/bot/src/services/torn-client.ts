/**
 * Bot-specific Torn API service with per-user rate limiting.
 * Uses the global @sentinel/shared TornApiClient with per-user rate limiter.
 *
 * Key difference from old system:
 * - Tracks rate limits per USER (not per API key)
 * - Respects Torn's actual limit: 100 req/min per user across all their keys
 * - Auto-marks invalid keys after multiple failures to prevent IP blocking
 */

import {
  TornApiClient,
  PerUserRateLimiter,
  TABLE_NAMES,
  TORN_ERROR_CODES,
} from "@sentinel/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markGuildApiKeyInvalid } from "../lib/guild-api-keys.js";

export interface ValidatedKeyInfo {
  playerId: number;
  playerName: string;
  isDonator: boolean;
  accessLevel: number;
}

/**
 * Create a Torn API client with per-user rate limiting for the bot
 */
export function createTornApiClient(supabase: SupabaseClient): TornApiClient {
  const API_KEY_HASH_PEPPER = process.env.API_KEY_HASH_PEPPER!;

  if (!API_KEY_HASH_PEPPER) {
    throw new Error("API_KEY_HASH_PEPPER environment variable is required");
  }

  const rateLimiter = new PerUserRateLimiter({
    supabase,
    tableName: TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER,
    apiKeyMappingTableName: TABLE_NAMES.API_KEY_USER_MAPPING,
    hashPepper: API_KEY_HASH_PEPPER,
    // Uses RATE_LIMITING.MAX_REQUESTS_PER_MINUTE from constants (50 req/min per user)
  });

  return new TornApiClient({
    rateLimitTracker: rateLimiter,
    onInvalidKey: async (apiKey, errorCode) => {
      console.warn(
        `Invalid guild API key detected (error code ${errorCode}), marking for deletion`,
      );
      await markGuildApiKeyInvalid(supabase, apiKey, 3); // Soft-delete after 3 failures
    },
  });
}

/**
 * Validates a Torn API key and returns key info.
 * Uses the TornApiClient for consistency.
 * @throws Error if validation fails
 */
export async function validateTornApiKey(
  apiKey: string,
  tornApi: TornApiClient,
): Promise<ValidatedKeyInfo> {
  // Validate API key format
  if (!/^[a-zA-Z0-9]{16}$/.test(apiKey)) {
    throw new Error("API Key must be exactly 16 alphanumeric characters");
  }

  // Fetch key info from Torn API
  const keyData = await tornApi.get("/key/info", { apiKey });

  // Validate response structure
  if (!keyData.info?.user?.id || keyData.info.access === undefined) {
    throw new Error("Invalid response from Torn API");
  }

  // Check access level (must be 3 or 4)
  if (keyData.info.access.level < 3) {
    throw new Error(
      `Insufficient permissions: Access level ${keyData.info.access.level}. Required: Limited Access (3) or Full Access (4)`,
    );
  }

  // Fetch user profile to get name and donator status
  const userData = await tornApi.get("/user/profile", { apiKey });

  if (!userData.profile?.name || !userData.profile?.id) {
    throw new Error("Invalid user profile response from Torn API");
  }

  return {
    playerId: userData.profile.id,
    playerName: userData.profile.name,
    isDonator: userData.profile.donator_status === "Donator",
    accessLevel: keyData.info.access.level,
  };
}

// Re-export error codes for convenience
export { TORN_ERROR_CODES };
