const TORN_API_BASE = "https://api.torn.com/v2";
const TORN_API_V1_BASE = "https://api.torn.com";
const REQUEST_TIMEOUT = 30000; // 30 seconds - increased from 10s for better reliability
export const TORN_ERROR_CODES = {
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
    rateLimitTracker;
    onInvalidKey;
    timeout;
    constructor(config = {}) {
        this.rateLimitTracker = config.rateLimitTracker;
        this.onInvalidKey = config.onInvalidKey;
        this.timeout = config.timeout ?? REQUEST_TIMEOUT;
    }
    /**
     * Implementation handles both overloads
     */
    async get(path, options) {
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
                    }
                    else {
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
            const data = (await response.json());
            // Check for Torn API error response
            if (data && typeof data === "object" && "error" in data) {
                const error = data.error;
                const errorMessage = TORN_ERROR_CODES[error.code] ||
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
        }
        finally {
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
    async getRaw(path, apiKey, queryParams) {
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
            const data = (await response.json());
            // Check for Torn API error response
            if (data && typeof data === "object" && "error" in data) {
                const error = data.error;
                const errorMessage = TORN_ERROR_CODES[error.code] ||
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
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    /**
     * Replace path parameters in URL template
     * Handles {paramName} placeholders
     */
    replacePath(path, params) {
        if (!params)
            return path;
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
    keys;
    currentIndex = 0;
    constructor(keys) {
        if (!keys.length) {
            throw new Error("ApiKeyRotator requires at least one API key");
        }
        this.keys = keys;
    }
    /**
     * Get the next key in round-robin rotation
     */
    getNextKey() {
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
    async processConcurrent(items, handler, delayMs = 0) {
        const results = [];
        const concurrency = this.keys.length;
        for (let i = 0; i < items.length; i += concurrency) {
            const batch = items.slice(i, i + concurrency);
            const batchResults = await Promise.all(batch.map((item, idx) => handler(item, this.keys[idx % this.keys.length])));
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
    async processSequential(items, handler, delayMs = 700) {
        const results = [];
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
    getKeyCount() {
        return this.keys.length;
    }
}
//# sourceMappingURL=torn.js.map