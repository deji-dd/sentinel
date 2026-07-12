import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

/**
 * Represents a stored, encrypted system or personal API key.
 */
export type SystemApiKeyDocument = BaseDocument & {
  user_id: number;
  api_key_encrypted: string;
  api_key_hash: string;
  is_primary: boolean;
  key_type: "personal" | "system";
  invalid_count: number;
  last_invalid_at: number | null;
};

/**
 * Maps a hashed API key to a specific Torn user ID for rate limit tracking.
 */
export type ApiKeyMappingDocument = BaseDocument & {
  api_key_hash: string;
  user_id: number;
  source: string;
};

/**
 * Tracks individual API requests per key to enforce Torn's 100/min rule.
 */
export type RateLimitDocument = BaseDocument & {
  api_key_hash: string;
  requested_at: number; // Stored as Unix epoch milliseconds for fast sorting
  user_id: number | null;
};

export const SystemApiKeys = new Collection<SystemApiKeyDocument>(
  sentinelDbEngine,
  "system_api_keys",
);
export const ApiKeyMappings = new Collection<ApiKeyMappingDocument>(
  sentinelDbEngine,
  "api_key_user_mapping",
);
export const RateLimits = new Collection<RateLimitDocument>(
  sentinelDbEngine,
  "rate_limit_requests_per_user",
);
