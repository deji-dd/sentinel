const TORN_API_BASE = "https://api.torn.com/v2";
const TORN_API_V1_BASE = "https://api.torn.com";
const REQUEST_TIMEOUT = 30000; // 30 seconds - increased from 10s for better reliability
export const TORN_ERROR_CODES = {
    0: "Unknown error",
    1: "Key is empty",
    2: "Incorrect Key: API key is wrong/incorrect format",
    5: "Too many requests: Rate limited (max 100 per minute)",
    6: "Incorrect ID: User ID doesn't exist",
    7: "Incorrect ID: Faction ID doesn't exist",
    8: "Incorrect ID: Company ID doesn't exist",
    9: "Function disabled: API disabled by admin",
    10: "Key not found: API key owner is in federal jail",
    11: "Key change error: Cannot change API key owner in tutorial",
    12: "Key read error: Could not read key from database",
    13: "The key is temporarily disabled due to owner inactivity",
    14: "Daily read limit reached",
    15: "Temporary error: API disabled for system maintenance",
    16: "Access level insufficient: Key does not have permission",
    17: "Backend error: API encountered an error",
    18: "API system overloaded",
    19: "Backend database error",
    20: "System error: API encountered an error",
    21: "System maintenance",
    22: "Invalid response: API response missing required fields",
    23: "Invalid route: API endpoint does not exist",
    24: "Invalid request: Malformed request parameters",
    25: "Invalid access level: Not allowed with current key access",
    26: "Key paused: API key has been paused by owner",
};
/**
 * Type-safe Torn API client with auto-complete for paths and query parameters
 */
export class TornApiClient {
    rateLimitTracker;
    timeout;
    constructor(config = {}) {
        this.rateLimitTracker = config.rateLimitTracker;
        this.timeout = config.timeout ?? REQUEST_TIMEOUT;
    }
    /**
     * Make a type-safe GET request to the Torn API
     */
    async get(path, options) {
        const { apiKey, pathParams, queryParams } = options;
        console.log(`[TornApi] Starting GET ${path}`);
        // Apply rate limiting if configured
        if (this.rateLimitTracker) {
            console.log("[TornApi] Checking rate limits...");
            await this.rateLimitTracker.waitIfNeeded(apiKey);
            console.log("[TornApi] Rate limit check passed");
        }
        // Build URL with path parameters
        let url = `${TORN_API_BASE}${this.buildPath(path, pathParams)}`;
        // Add query parameters
        const params = new URLSearchParams();
        params.append("key", apiKey);
        if (queryParams) {
            for (const [key, value] of Object.entries(queryParams)) {
                if (value !== undefined && value !== null) {
                    params.append(key, String(value));
                }
            }
        }
        url += `?${params.toString()}`;
        console.log(`[TornApi] URL: ${url.replace(apiKey, "***")}`);
        // Make request with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            console.log(`[TornApi] Request timeout after ${this.timeout}ms`);
            controller.abort();
        }, this.timeout);
        try {
            console.log("[TornApi] Sending fetch request...");
            const response = await fetch(url, {
                signal: controller.signal,
                headers: { Accept: "application/json" },
            });
            console.log(`[TornApi] Received response: ${response.status}`);
            const data = (await response.json());
            // Check for API errors
            if (data && typeof data === "object" && "error" in data) {
                const error = data.error;
                const errorMessage = TORN_ERROR_CODES[error.code] || `Error code ${error.code}`;
                throw new Error(errorMessage);
            }
            if (!response.ok) {
                throw new Error(`Torn API returned status ${response.status}`);
            }
            // Record request for rate limiting
            if (this.rateLimitTracker) {
                console.log("[TornApi] Recording request completion...");
                await this.rateLimitTracker.recordRequest(apiKey);
                console.log("[TornApi] Request recorded");
            }
            console.log("[TornApi] Request completed successfully");
            return data;
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    /**
     * Make a raw GET request to the Torn API (for v1 endpoints not in OpenAPI spec)
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
                if (value !== undefined && value !== null) {
                    params.append(key, value);
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
            // Check for API errors
            if (data && typeof data === "object" && "error" in data) {
                const error = data.error;
                const errorMessage = TORN_ERROR_CODES[error.code] || `Error code ${error.code}`;
                throw new Error(errorMessage);
            }
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
     * Build path with path parameters (e.g., /user/{id}/basic -> /user/123/basic)
     */
    buildPath(path, pathParams) {
        if (!pathParams)
            return path;
        let result = path;
        for (const [key, value] of Object.entries(pathParams)) {
            result = result.replace(`{${key}}`, String(value));
        }
        return result;
    }
}
/**
 * API Key Rotation Manager for distributing requests across multiple keys.
 * Supports sequential or concurrent batch processing.
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