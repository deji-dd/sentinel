/**
 * Bot-specific Torn API service with per-user rate limiting.
 * Uses the global @sentinel/shared TornApiClient with per-user rate limiter.
 *
 * Key difference from old system:
 * - Tracks rate limits per USER (not per API key)
 * - Respects Torn's actual limit: 100 req/min per user across all their keys
 * - Auto-marks invalid keys (error code 2) after multiple failures to prevent IP blocking
 */

import {
  TornApiClient,
  BatchOperationHandler,
  ApiKeyRotator,
} from "@sentinel/shared";
import { markGuildApiKeyInvalid } from "../lib/guild-api-keys.js";
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

class BotSqliteRateLimiter {
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

const rateLimiter = new BotSqliteRateLimiter();

export interface ValidatedKeyInfo {
  playerId: number;
  playerName: string;
  isDonator: boolean;
  accessLevel: number;
}

/**
 * Create a Torn API client with per-user rate limiting for the bot
 * Uses the centralized factory from @sentinel/shared
 */
export const tornApi = new TornApiClient({
  rateLimitTracker: rateLimiter,
  onInvalidKey: async (apiKey: string) => {
    console.warn(
      `Invalid guild API key detected (error code 2), marking for deletion`,
    );
    await markGuildApiKeyInvalid(apiKey, 3); // Soft-delete after 3 failures
  },
});

export const batchHandler = new BatchOperationHandler(rateLimiter);

export { ApiKeyRotator, BatchOperationHandler };

/**
 * Validates a Torn API key and returns key info.
 * Uses the TornApiClient for consistency.
 * @throws Error if validation fails
 */
export async function validateTornApiKey(
  apiKey: string,
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
