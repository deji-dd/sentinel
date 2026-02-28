import type { components, operations, paths } from "./generated/torn-api.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PerUserRateLimiter } from "./per-user-rate-limiter.js";
import { TABLE_NAMES } from "./constants.js";

const TORN_API_BASE = "https://api.torn.com/v2";
const TORN_API_V1_BASE = "https://api.torn.com";
const REQUEST_TIMEOUT = 30000; // 30 seconds - increased from 10s for better reliability

/**
 * Torn API Error Response - properly typed from OpenAPI spec
 */
export interface TornApiError {
  error: {
    code: number;
    error: string;
  };
}

export const TORN_ERROR_CODES: Record<number, string> = {
  0: "Unknown error",
  1: "Key is empty",
  2: "Incorrect key",
  3: "Wrong type",
  4: "Wrong fields",
  5: "Too many requests",
  6: "Incorrect ID",
  7: "Incorrect ID/entity relation",
  8: "IP blocked",
  9: "API disabled",
  10: "Key owner in federal jail",
  11: "Key change cooldown",
  12: "Key read error",
  13: "Key temporarily disabled",
  14: "Daily read limit reached",
  15: "Log unavailable",
  16: "Access level too low",
  17: "Backend error",
  18: "API key paused",
  19: "Must migrate to Crimes v2",
  20: "Race not finished",
  21: "Incorrect category",
  22: "Only available in API v1",
  23: "Only available in API v2",
  24: "Closed temporarily",
  25: "Invalid stat requested",
  26: "Only category or stats allowed",
  27: "Must migrate to Organized Crimes v2",
  28: "Incorrect log ID",
  29: "Category selection unavailable for interaction logs",
};

/**
 * Rate limiting tracker interface - implement this to provide rate limiting
 */
export interface RateLimitTracker {
  waitIfNeeded(apiKey: string): Promise<void>;
  recordRequest(apiKey: string): Promise<void>;
  getRequestCount?(apiKey: string): Promise<number>;
}

/**
 * Configuration for TornApiClient
 */
export interface TornApiConfig {
  rateLimitTracker?: RateLimitTracker;
  timeout?: number;
  onInvalidKey?: (apiKey: string, errorCode: number) => Promise<void>;
}

/**
 * Extract operation from path - handles both get operations
 */
type PathOperation<P extends keyof paths> = paths[P] extends { get: infer Op }
  ? Op
  : never;

/**
 * Extract successful response from operation
 */
type OperationResponse<Op> = Op extends {
  responses: { 200: { content: { "application/json": infer R } } };
}
  ? R
  : never;

/**
 * Extract query parameters from operation
 */
type OperationQueryParams<Op> = Op extends {
  parameters: { query?: infer Q };
}
  ? Q extends Record<string, any>
    ? Q
    : {}
  : {};

/**
 * Extract path parameters from operation
 */
type OperationPathParams<Op> = Op extends {
  parameters: { path?: infer P };
}
  ? P extends Record<string, any>
    ? P
    : {}
  : {};

/**
 * Type-safe Torn API v2 client with full type inference
 *
 * Features:
 * - Full type inference for paths from OpenAPI spec
 * - Automatic query parameter typing per endpoint
 * - Automatic path parameter typing per endpoint
 * - Proper response type discrimination
 * - Error handling with typed error codes
 */
export class TornApiClient {
  private rateLimitTracker?: RateLimitTracker;
  private onInvalidKey?: (apiKey: string, errorCode: number) => Promise<void>;
  private timeout: number;

  constructor(config: TornApiConfig = {}) {
    this.rateLimitTracker = config.rateLimitTracker;
    this.onInvalidKey = config.onInvalidKey;
    this.timeout = config.timeout ?? REQUEST_TIMEOUT;
  }

  /**
   * Type-safe GET request with full inference
   *
   * @example
   * // Full type inference and autocomplete
   * const result = await client.get("/user/basic", {
   *   apiKey: myKey,
   *   queryParams: { striptags: "true" } // Type-checked!
   * });
   * // result is typed as UserBasicResponse
   */
  async get<P extends keyof paths>(
    path: P,
    options: {
      apiKey: string;
      pathParams?: OperationPathParams<PathOperation<P>>;
      queryParams?: OperationQueryParams<PathOperation<P>>;
    },
  ): Promise<OperationResponse<PathOperation<P>>>;

  /**
   * Dynamic path variant for runtime-constructed paths
   */
  async get<T extends Record<string, any> = any>(
    path: string,
    options: {
      apiKey: string;
      pathParams?: Record<string, string | number>;
      queryParams?: Record<string, any>;
    },
  ): Promise<T>;

  /**
   * Implementation handles both overloads
   */
  async get<
    P extends keyof paths = keyof paths,
    T extends Record<string, any> = any,
  >(
    path: P | string,
    options: {
      apiKey: string;
      pathParams?: Record<string, string | number | any>;
      queryParams?: Record<string, any>;
    },
  ): Promise<OperationResponse<PathOperation<P>> | T> {
    const { apiKey, pathParams, queryParams } = options;

    // Apply rate limiting if configured
    if (this.rateLimitTracker) {
      await this.rateLimitTracker.waitIfNeeded(apiKey);
    }

    // Build URL with path parameters - replace {param} placeholders
    let url = `${TORN_API_BASE}${this.replacePath(String(path), pathParams)}`;

    // Build query string
    const params = new URLSearchParams();
    params.append("key", apiKey);

    // Add timestamp to bypass cache
    params.append("timestamp", String(Math.floor(Date.now() / 1000)));

    // Add custom query parameters with proper handling for various types
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null && value !== "") {
          if (Array.isArray(value)) {
            params.append(key, value.join(","));
          } else {
            params.append(key, String(value));
          }
        }
      }
    }

    url += `?${params.toString()}`;

    // Make request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      const data = (await response.json()) as any;

      // Check for Torn API error response
      if (data && typeof data === "object" && "error" in data) {
        const error = data.error as { code: number; error: string };
        const errorMessage =
          TORN_ERROR_CODES[error.code] ||
          error.error ||
          `Error code ${error.code}`;

        // Call invalid key handler for error code 2 (Incorrect Key)
        // This allows apps to soft-delete keys after multiple failures
        if (error.code === 2 && this.onInvalidKey) {
          await this.onInvalidKey(apiKey, error.code);
        }

        throw new Error(errorMessage);
      }

      // Check for HTTP errors
      if (!response.ok) {
        throw new Error(`Torn API returned status ${response.status}`);
      }

      // Record request for rate limiting
      if (this.rateLimitTracker) {
        await this.rateLimitTracker.recordRequest(apiKey);
      }

      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Make a raw GET request to Torn API v1 endpoints not in OpenAPI spec
   *
   * @example
   * const data = await client.getRaw<any>(
   *   "/user",
   *   apiKey,
   *   { selections: "crimes,perks" }
   * );
   */
  async getRaw<T extends Record<string, any> = any>(
    path: string,
    apiKey: string,
    queryParams?: Record<string, string | number | boolean>,
  ): Promise<T> {
    // Apply rate limiting if configured
    if (this.rateLimitTracker) {
      await this.rateLimitTracker.waitIfNeeded(apiKey);
    }

    // Build URL
    let url = `${TORN_API_V1_BASE}${path}`;

    const params = new URLSearchParams();
    params.append("key", apiKey);

    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null && value !== "") {
          params.append(key, String(value));
        }
      }
    }

    url += `?${params.toString()}`;

    // Make request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      const data = (await response.json()) as any;

      // Check for Torn API error response
      if (data && typeof data === "object" && "error" in data) {
        const error = data.error as { code: number; error: string };
        const errorMessage =
          TORN_ERROR_CODES[error.code] ||
          error.error ||
          `Error code ${error.code}`;

        // Call invalid key handler for error code 2 (Incorrect Key)
        // This allows apps to soft-delete keys after multiple failures
        if (error.code === 2 && this.onInvalidKey) {
          await this.onInvalidKey(apiKey, error.code);
        }

        throw new Error(errorMessage);
      }

      // Check for HTTP errors
      if (!response.ok) {
        throw new Error(`Torn API returned status ${response.status}`);
      }

      // Record request for rate limiting
      if (this.rateLimitTracker) {
        await this.rateLimitTracker.recordRequest(apiKey);
      }

      return data as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Replace path parameters in URL template
   * Handles {paramName} placeholders
   */
  private replacePath(
    path: string,
    params?: Record<string, string | number>,
  ): string {
    if (!params) return path;

    let result = path;
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(`{${key}}`, String(value));
    }
    return result;
  }
}

/**
 * API Key Rotation Manager for distributing requests across multiple keys.
 * Supports sequential or concurrent batch processing.
 *
 * @example
 * const rotator = new ApiKeyRotator([key1, key2, key3]);
 *
 * // Sequential with delay
 * const results = await rotator.processSequential(
 *   items,
 *   async (item, key) => {
 *     return client.get("/user/basic", { apiKey: key });
 *   },
 *   700 // 700ms delay between requests
 * );
 *
 * // Concurrent - one per key in parallel
 * const results = await rotator.processConcurrent(
 *   items,
 *   async (item, key) => {
 *     return client.get("/user/basic", { apiKey: key });
 *   }
 * );
 */
export class ApiKeyRotator {
  private keys: string[];
  private currentIndex: number = 0;

  constructor(keys: string[]) {
    if (!keys.length) {
      throw new Error("ApiKeyRotator requires at least one API key");
    }
    this.keys = keys;
  }

  /**
   * Get the next key in round-robin rotation
   */
  getNextKey(): string {
    const key = this.keys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return key;
  }

  /**
   * Process items concurrently, one per API key in parallel.
   * Useful when you have N keys and want N concurrent requests.
   *
   * @example
   * const results = await rotator.processConcurrent(
   *   userIds,
   *   async (userId, key) => client.get("/user/{id}/basic", { apiKey: key, pathParams: { id: userId } }),
   *   100 // 100ms delay between batches
   * );
   */
  async processConcurrent<T, R>(
    items: T[],
    handler: (item: T, apiKey: string) => Promise<R>,
    delayMs: number = 0,
  ): Promise<R[]> {
    const results: R[] = [];
    const concurrency = this.keys.length;

    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((item, idx) =>
          handler(item, this.keys[idx % this.keys.length]),
        ),
      );
      results.push(...batchResults);

      // Delay before next batch (except after last)
      if (i + concurrency < items.length && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  /**
   * Process items sequentially with per-request delay and key rotation.
   * Each request uses the next key in order.
   *
   * @example
   * const results = await rotator.processSequential(
   *   userIds,
   *   async (userId, key) => client.get("/user/{id}/basic", { apiKey: key, pathParams: { id: userId } }),
   *   700 // 700ms between each request
   * );
   */
  async processSequential<T, R>(
    items: T[],
    handler: (item: T, apiKey: string) => Promise<R>,
    delayMs: number = 700,
  ): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const apiKey = this.getNextKey();
      const result = await handler(item, apiKey);
      results.push(result);

      // Delay between requests (except after last)
      if (i < items.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  /**
   * Get number of available keys
   */
  getKeyCount(): number {
    return this.keys.length;
  }
}

/**
 * Guild-based API key round-robin distributor
 * Maintains independent rotation index per guild
 * Used by Discord bot for distributing requests across guild API keys
 */
const guildKeyIndices = new Map<string, number>();

/**
 * Get next API key for a guild using round-robin rotation
 * Maintains state per guild to ensure fair distribution
 *
 * @example
 * const key = getNextApiKey("guild123", ["key1", "key2", "key3"]);
 * const anotherKey = getNextApiKey("guild123", ["key1", "key2", "key3"]); // Gets next key
 */
export function getNextApiKey(guildId: string, keys: string[]): string {
  if (keys.length === 1) {
    return keys[0];
  }

  const currentIndex = guildKeyIndices.get(guildId) ?? 0;
  const nextIndex = currentIndex % keys.length;
  guildKeyIndices.set(guildId, nextIndex + 1);

  return keys[nextIndex];
}

/**
 * Factory function to create a TornApiClient with per-user rate limiting
 * Centralizes rate limiter setup that was previously duplicated across apps
 *
 * Only triggers soft-delete on error code 2 (Incorrect key / invalid API key)
 * Other errors (rate limits, temporary issues, etc.) do NOT trigger soft-delete
 *
 * @param config Configuration for rate limiting
 * @param config.supabase Supabase client for database operations
 * @param config.hashPepper Pepper for hashing API keys (from API_KEY_HASH_PEPPER env)
 * @param config.onInvalidKey Callback when error code 2 (invalid key) occurs
 *
 * @example
 * // Worker setup
 * export const tornApi = createTornApiClient({
 *   supabase,
 *   hashPepper: API_KEY_HASH_PEPPER,
 *   onInvalidKey: async (apiKey) => {
 *     await markSystemApiKeyInvalid(apiKey, 3); // Soft-delete
 *   },
 * });
 *
 * // Bot setup
 * export const tornApi = createTornApiClient({
 *   supabase,
 *   hashPepper: API_KEY_HASH_PEPPER,
 *   onInvalidKey: async (apiKey) => {
 *     await markGuildApiKeyInvalid(supabase, apiKey, 3);
 *   },
 * });
 */
export function createTornApiClient(config: {
  supabase: SupabaseClient;
  hashPepper: string;
  onInvalidKey?: (apiKey: string) => Promise<void>;
}): TornApiClient {
  const rateLimiter = new PerUserRateLimiter({
    supabase: config.supabase,
    tableName: TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER,
    apiKeyMappingTableName: TABLE_NAMES.API_KEY_USER_MAPPING,
    hashPepper: config.hashPepper,
  });

  return new TornApiClient({
    rateLimitTracker: rateLimiter,
    // CRITICAL: Only soft-delete on error code 2 (Incorrect key)
    // Other errors like rate limits or temporary issues should NOT trigger deletion
    onInvalidKey: config.onInvalidKey
      ? async (apiKey, errorCode) => {
          if (errorCode === 2) {
            // Incorrect key - this is the only case where we should soft-delete
            await config.onInvalidKey!(apiKey);
          }
        }
      : undefined,
  });
}
