import type { paths } from "./generated/torn-api.js";
type PathsWithMethod<Method extends keyof paths[keyof paths]> = {
    [Path in keyof paths]: Method extends keyof paths[Path] ? Path : never;
}[keyof paths];
type GetPaths = PathsWithMethod<"get">;
type PathParameters<Path extends keyof paths> = paths[Path] extends {
    get: {
        parameters: {
            path: infer P;
        };
    };
} ? P : never;
type QueryParameters<Path extends keyof paths> = paths[Path] extends {
    get: {
        parameters: {
            query?: infer Q;
        };
    };
} ? Q : never;
type ResponseData<Path extends keyof paths> = paths[Path] extends {
    get: {
        responses: {
            200: {
                content: {
                    "application/json": infer R;
                };
            };
        };
    };
} ? R : never;
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
     * Make a type-safe GET request to the Torn API
     */
    get<Path extends GetPaths>(path: Path, options: {
        apiKey: string;
        pathParams?: PathParameters<Path>;
        queryParams?: Omit<QueryParameters<Path>, "key">;
    }): Promise<ResponseData<Path>>;
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
export {};
//# sourceMappingURL=torn.d.ts.map