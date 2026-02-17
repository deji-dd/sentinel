export interface TornApiError {
    error: {
        code: number;
        error: string;
    };
}
export declare const TORN_ERROR_CODES: Record<number, string>;
/**
 * Rate limiting tracker interface - implement this to provide rate limiting
 */
export interface RateLimitTracker {
    waitIfNeeded(apiKey: string): Promise<void>;
    recordRequest(apiKey: string): Promise<void>;
}
/**
 * Configuration for TornApiClient
 */
export interface TornApiConfig {
    rateLimitTracker?: RateLimitTracker;
    timeout?: number;
}
/**
 * Type-safe Torn API client with auto-complete for paths and query parameters
 */
export declare class TornApiClient {
    private rateLimitTracker?;
    private timeout;
    constructor(config?: TornApiConfig);
    /**
     * Make a GET request to the Torn API v2 (supports both typed and dynamic paths)
     */
    get<T = any>(path: string, options: {
        apiKey: string;
        pathParams?: Record<string, string | number>;
        queryParams?: Record<string, string | string[]>;
    }): Promise<T>;
    /**
     * Make a raw GET request to the Torn API (for v1 endpoints not in OpenAPI spec)
     */
    getRaw<T>(path: string, apiKey: string, queryParams?: Record<string, string>): Promise<T>;
    /**
     * Build path with path parameters (e.g., /user/{id}/basic -> /user/123/basic)
     */
    private buildPath;
}
/**
 * API Key Rotation Manager for distributing requests across multiple keys.
 * Supports sequential or concurrent batch processing.
 */
export declare class ApiKeyRotator {
    private keys;
    private currentIndex;
    constructor(keys: string[]);
    /**
     * Get the next key in round-robin rotation
     */
    getNextKey(): string;
    /**
     * Process items concurrently, one per API key in parallel.
     * Useful when you have N keys and want N concurrent requests.
     */
    processConcurrent<T, R>(items: T[], handler: (item: T, apiKey: string) => Promise<R>, delayMs?: number): Promise<R[]>;
    /**
     * Process items sequentially with per-request delay and key rotation.
     */
    processSequential<T, R>(items: T[], handler: (item: T, apiKey: string) => Promise<R>, delayMs?: number): Promise<R[]>;
    /**
     * Get number of available keys
     */
    getKeyCount(): number;
}
//# sourceMappingURL=torn.d.ts.map