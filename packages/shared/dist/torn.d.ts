import type { paths } from "./generated/torn-api.js";
/**
 * Torn API Error Response - properly typed from OpenAPI spec
 */
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
type PathOperation<P extends keyof paths> = paths[P] extends {
    get: infer Op;
} ? Op : never;
/**
 * Extract successful response from operation
 */
type OperationResponse<Op> = Op extends {
    responses: {
        200: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : never;
/**
 * Extract query parameters from operation
 */
type OperationQueryParams<Op> = Op extends {
    parameters: {
        query?: infer Q;
    };
} ? Q extends Record<string, any> ? Q : {} : {};
/**
 * Extract path parameters from operation
 */
type OperationPathParams<Op> = Op extends {
    parameters: {
        path?: infer P;
    };
} ? P extends Record<string, any> ? P : {} : {};
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
export declare class TornApiClient {
    private rateLimitTracker?;
    private onInvalidKey?;
    private timeout;
    constructor(config?: TornApiConfig);
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
    get<P extends keyof paths>(path: P, options: {
        apiKey: string;
        pathParams?: OperationPathParams<PathOperation<P>>;
        queryParams?: OperationQueryParams<PathOperation<P>>;
    }): Promise<OperationResponse<PathOperation<P>>>;
    /**
     * Dynamic path variant for runtime-constructed paths
     */
    get<T extends Record<string, any> = any>(path: string, options: {
        apiKey: string;
        pathParams?: Record<string, string | number>;
        queryParams?: Record<string, any>;
    }): Promise<T>;
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
    getRaw<T extends Record<string, any> = any>(path: string, apiKey: string, queryParams?: Record<string, string | number | boolean>): Promise<T>;
    /**
     * Replace path parameters in URL template
     * Handles {paramName} placeholders
     */
    private replacePath;
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
     *
     * @example
     * const results = await rotator.processConcurrent(
     *   userIds,
     *   async (userId, key) => client.get("/user/{id}/basic", { apiKey: key, pathParams: { id: userId } }),
     *   100 // 100ms delay between batches
     * );
     */
    processConcurrent<T, R>(items: T[], handler: (item: T, apiKey: string) => Promise<R>, delayMs?: number): Promise<R[]>;
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
    processSequential<T, R>(items: T[], handler: (item: T, apiKey: string) => Promise<R>, delayMs?: number): Promise<R[]>;
    /**
     * Get number of available keys
     */
    getKeyCount(): number;
}
export {};
//# sourceMappingURL=torn.d.ts.map