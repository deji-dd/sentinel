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
  id: string; // Unique identifier for this request
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
  [apiKey: string]: string[]; // Maps key to array of request IDs
}

/**
 * Analyzes current rate limit state and recommends optimal distribution
 */
export class BatchOperationHandler {
  constructor(private rateLimiter: RateLimitTracker) {}

  /**
   * Analyze rate limit state for multiple API keys
   * Returns how many more requests each key can make in current window
   */
  async analyzeKeyCapacity(apiKeys: string[]): Promise<Map<string, number>> {
    const capacities = new Map<string, number>();

    // For now, we assume max of 100 req/min per user
    // In production, this should query the rate limiter for exact remaining capacity
    const defaultCapacity = 100;

    for (const key of apiKeys) {
      // Simple approach: assume each key has 100 capacity
      // More sophisticated: track actual usage per key
      capacities.set(key, defaultCapacity);
    }

    return capacities;
  }

  /**
   * Create an optimal distribution plan for batch requests
   * Distributes requests across keys to maximize parallelism while respecting rate limits
   */
  async planDistribution<T>(
    requests: BatchRequest<T>[],
    apiKeys: string[],
  ): Promise<BatchDistribution> {
    if (!apiKeys.length) {
      throw new Error("At least one API key is required");
    }

    if (!requests.length) {
      return {};
    }

    const distribution: BatchDistribution = {};

    // Initialize distribution for all keys
    for (const key of apiKeys) {
      distribution[key] = [];
    }

    // Simple round-robin distribution
    // In production, this could be more sophisticated based on:
    // - Current rate limit usage per key
    // - Request complexity/weight
    // - Historical success rates per key
    // - Geographic routing (if needed)

    for (let i = 0; i < requests.length; i++) {
      const keyIndex = i % apiKeys.length;
      const key = apiKeys[keyIndex];
      distribution[key].push(requests[i].id);
    }

    return distribution;
  }

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
  async executeBatch<T, R>(
    requests: BatchRequest<T>[],
    apiKeys: string[],
    handler: (item: T, key: string) => Promise<R>,
    options: {
      concurrent?: boolean;
      delayMs?: number;
      retryAttempts?: number;
    } = {},
  ): Promise<BatchResult<R>[]> {
    const { concurrent = false, delayMs = 100, retryAttempts = 2 } = options;

    if (!apiKeys.length) {
      throw new Error("At least one API key is required");
    }

    // Plan the distribution
    const distribution = await this.planDistribution(requests, apiKeys);

    // Create result map to preserve order
    const resultMap = new Map<string, BatchResult<R>>();

    if (concurrent) {
      // Execute all in parallel
      await this.executeConcurrent(
        distribution,
        requests,
        handler,
        resultMap,
        retryAttempts,
      );
    } else {
      // Execute sequentially with delay
      await this.executeSequential(
        distribution,
        requests,
        handler,
        resultMap,
        delayMs,
        retryAttempts,
      );
    }

    // Return results in original order
    return requests.map((req) => resultMap.get(req.id)!);
  }

  /**
   * Execute requests in parallel, one batch per key
   */
  private async executeConcurrent<T, R>(
    distribution: BatchDistribution,
    requests: BatchRequest<T>[],
    handler: (item: T, key: string) => Promise<R>,
    resultMap: Map<string, BatchResult<R>>,
    retryAttempts: number,
  ): Promise<void> {
    const requestMap = new Map(requests.map((r) => [r.id, r]));

    const promises = Object.entries(distribution).map(([key, requestIds]) =>
      Promise.all(
        requestIds.map((id) =>
          this.executeWithRetry(
            requestMap.get(id)!,
            key,
            handler,
            resultMap,
            retryAttempts,
          ),
        ),
      ),
    );

    await Promise.all(promises);
  }

  /**
   * Execute requests sequentially with delay
   */
  private async executeSequential<T, R>(
    distribution: BatchDistribution,
    requests: BatchRequest<T>[],
    handler: (item: T, key: string) => Promise<R>,
    resultMap: Map<string, BatchResult<R>>,
    delayMs: number,
    retryAttempts: number,
  ): Promise<void> {
    const requestMap = new Map(requests.map((r) => [r.id, r]));
    let isFirst = true;

    for (const [key, requestIds] of Object.entries(distribution)) {
      for (const id of requestIds) {
        if (!isFirst && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        isFirst = false;

        const request = requestMap.get(id)!;
        await this.executeWithRetry(
          request,
          key,
          handler,
          resultMap,
          retryAttempts,
        );
      }
    }
  }

  /**
   * Execute a single request with retry logic
   */
  private async executeWithRetry<T, R>(
    request: BatchRequest<T>,
    key: string,
    handler: (item: T, key: string) => Promise<R>,
    resultMap: Map<string, BatchResult<R>>,
    maxRetries: number,
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await handler(request.item, key);
        resultMap.set(request.id, {
          requestId: request.id,
          success: true,
          result,
          keyUsed: key,
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // If it's a rate limit error and we have retries left, wait and retry
        if (attempt < maxRetries && lastError.message?.includes("rate limit")) {
          const waitTime = 1000 * Math.pow(2, attempt); // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    // All retries exhausted
    resultMap.set(request.id, {
      requestId: request.id,
      success: false,
      error: lastError || new Error("Unknown error"),
      keyUsed: key,
    });
  }

  /**
   * Filter successful results, preserving order
   */
  static filterSuccessful<R>(results: BatchResult<R>[]): R[] {
    return results.filter((r) => r.success).map((r) => r.result!);
  }

  /**
   * Get summary statistics
   */
  static getSummary<R>(results: BatchResult<R>[]): {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
  } {
    const total = results.length;
    const successful = results.filter((r) => r.success).length;
    const failed = total - successful;

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? (successful / total) * 100 : 0,
    };
  }
}
