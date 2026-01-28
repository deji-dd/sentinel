/**
 * Worker-specific Torn API service with rate limiting integration.
 * Uses the global @sentinel/shared TornApiClient with worker's rate limiter.
 */

import {
  TornApiClient,
  DatabaseRateLimiter,
  ApiKeyRotator,
  TABLE_NAMES,
} from "@sentinel/shared";
import { supabase } from "../lib/supabase.js";

const API_KEY_HASH_PEPPER = process.env.API_KEY_HASH_PEPPER!;

if (!API_KEY_HASH_PEPPER) {
  throw new Error("API_KEY_HASH_PEPPER environment variable is required");
}

/**
 * Global rate limiter instance for worker
 */
const rateLimiter = new DatabaseRateLimiter({
  supabase,
  tableName: TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER,
  hashPepper: API_KEY_HASH_PEPPER,
});

/**
 * Global Torn API client instance with worker rate limiting
 */
export const tornApi = new TornApiClient({
  rateLimitTracker: rateLimiter,
});

/**
 * Export ApiKeyRotator for batch operations
 */
export { ApiKeyRotator };
