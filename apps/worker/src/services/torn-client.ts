/**
 * Worker-specific Torn API service with per-user rate limiting.
 * Uses the global @sentinel/shared TornApiClient with per-user rate limiter.
 *
 * Key difference from old system:
 * - Tracks rate limits per USER (not per API key)
 * - Respects Torn's actual limit: 100 req/min per user across all their keys
 * - Supports batch operations with smart key distribution
 */

import {
  TornApiClient,
  PerUserRateLimiter,
  BatchOperationHandler,
  ApiKeyRotator,
  TABLE_NAMES,
} from "@sentinel/shared";
import { supabase } from "../lib/supabase.js";

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
  maxRequestsPerWindow: 100, // Torn's actual limit
});

/**
 * Global Torn API client instance with per-user rate limiting
 */
export const tornApi = new TornApiClient({
  rateLimitTracker: rateLimiter,
});

/**
 * Global batch operation handler for distributing requests optimally
 */
export const batchHandler = new BatchOperationHandler(rateLimiter);

/**
 * Export utilities for use in workers
 */
export { ApiKeyRotator, PerUserRateLimiter, BatchOperationHandler };

