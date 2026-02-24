/**
 * Smart Batch Operation Handler
 * Optimally distributes batch API requests across multiple keys while respecting rate limits
 *
 * Features:
 * - Analyzes current rate limit state for all keys
 * - Distributes requests to maximize throughput
 * - Considers which keys have available quota
 * - Handles failures and retries intelligently
 * - Preserves result order matching input order
 */
import type { RateLimitTracker } from "./torn.js";
export interface BatchRequest<T> {
    id: string;
    item: T;
    metadata?: Record<string, any>;
}
export interface BatchResult<R> {
    requestId: string;
    success: boolean;
    result?: R;
    error?: Error;
    keyUsed?: string;
}
export interface BatchDistribution {
    [apiKey: string]: string[];
}
/**
 * Analyzes current rate limit state and recommends optimal distribution
 */
export declare class BatchOperationHandler {
    private rateLimiter;
    constructor(rateLimiter: RateLimitTracker);
    /**
     * Analyze rate limit state for multiple API keys
     * Returns how many more requests each key can make in current window
     */
    analyzeKeyCapacity(apiKeys: string[]): Promise<Map<string, number>>;
    /**
     * Create an optimal distribution plan for batch requests
     * Distributes requests across keys to maximize throughput while respecting rate limits
     */
    planDistribution<T>(requests: BatchRequest<T>[], apiKeys: string[]): Promise<BatchDistribution>;
    /**
     * Execute a batch of requests with optimal key distribution
     *
     * @example
     * const handler = new BatchOperationHandler(rateLimiter);
     * const results = await handler.executeBatch(
     *   [
     *     { id: "req1", item: { userId: 123 } },
     *     { id: "req2", item: { userId: 456 } },
     *   ],
     *   userKeys,
     *   async (item, key) => {
     *     return await tornApi.get("/user/basic", { apiKey: key });
     *   }
     * );
     */
    executeBatch<T, R>(requests: BatchRequest<T>[], apiKeys: string[], handler: (item: T, key: string) => Promise<R>, options?: {
        concurrent?: boolean;
        delayMs?: number;
        retryAttempts?: number;
    }): Promise<BatchResult<R>[]>;
    /**
     * Execute requests concurrently per key (but sequentially within each key)
     * This respects rate limits while still parallelizing across multiple keys
     */
    private executeConcurrent;
    /**
     * Execute requests sequentially with delay
     */
    private executeSequential;
    /**
     * Execute a single request with rate limit awareness and retry logic
     */
    private executeWithRetry;
    /**
     * Filter successful results, preserving order
     */
    static filterSuccessful<R>(results: BatchResult<R>[]): R[];
    /**
     * Get summary statistics
     */
    static getSummary<R>(results: BatchResult<R>[]): {
        total: number;
        successful: number;
        failed: number;
        successRate: number;
    };
}
//# sourceMappingURL=batch-operation-handler.d.ts.map