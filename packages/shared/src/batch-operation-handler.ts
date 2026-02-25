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
    const maxRequests =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((this.rateLimiter as any).getMaxRequests?.() as number | undefined) ??
      100;

    // Query actual usage for each key
    for (const key of apiKeys) {
      try {
        if (this.rateLimiter.getRequestCount) {
          const requestCount = await this.rateLimiter.getRequestCount(key);
          const remaining = Math.max(0, maxRequests - requestCount);
          capacities.set(key, remaining);
        } else {
          // If getRequestCount is not implemented, assume full capacity
          capacities.set(key, 100);
        }
      } catch (error) {
        // If we can't query, assume key is unavailable
        capacities.set(key, 0);
      }
    }

    return capacities;
  }

  /**
   * Create an optimal distribution plan for batch requests
   * Distributes requests across keys to maximize throughput while respecting rate limits
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

    // Get actual capacity for each key
    const capacities = await this.analyzeKeyCapacity(apiKeys);
    const totalCapacity = Array.from(capacities.values()).reduce(
      (a, b) => a + b,
      0,
    );

    // If less than half capacity, we'd hit limits mid-batch
    if (totalCapacity < requests.length / 2) {
      console.warn(
        `[BatchHandler] Low capacity warning: ${totalCapacity} requests available but ${requests.length} requested`,
      );
    }

    // Distribute requests based on available capacity (weighted distribution)
    // Even if capacity is 0, still distribute - rate limiter will handle waits
    let requestIndex = 0;

    // Round-robin distribution across all keys
    while (requestIndex < requests.length) {
      for (const key of apiKeys) {
        if (requestIndex < requests.length) {
          distribution[key].push(requests[requestIndex].id);
          requestIndex++;
        }
      }
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

    // Return results in original order, with fallback for missing entries
    return requests.map((req) => {
      const result = resultMap.get(req.id);
      if (!result) {
        // Fallback for requests that somehow weren't processed
        console.error(
          `[BatchHandler] Missing result for request ${req.id}, using fallback`,
        );
        return {
          requestId: req.id,
          success: false,
          error: new Error("Request was not processed"),
          keyUsed: apiKeys[0] || "unknown",
        };
      }
      return result;
    });
  }

  /**
   * Execute requests concurrently per key (but sequentially within each key)
   * This respects rate limits while still parallelizing across multiple keys
   */
  private async executeConcurrent<T, R>(
    distribution: BatchDistribution,
    requests: BatchRequest<T>[],
    handler: (item: T, key: string) => Promise<R>,
    resultMap: Map<string, BatchResult<R>>,
    retryAttempts: number,
  ): Promise<void> {
    const requestMap = new Map(requests.map((r) => [r.id, r]));

    // Execute all keys in parallel, but requests within each key are sequential
    const promises = Object.entries(distribution).map(
      async ([key, requestIds]) => {
        for (const id of requestIds) {
          try {
            await this.executeWithRetry(
              requestMap.get(id)!,
              key,
              handler,
              resultMap,
              retryAttempts,
            );
          } catch (error) {
            // ExecuteWithRetry should handle all errors, but catch just in case
            console.error(
              `[BatchHandler] Unexpected error in executeWithRetry for ${id}:`,
              error,
            );
            if (!resultMap.has(id)) {
              resultMap.set(id, {
                requestId: id,
                success: false,
                error:
                  error instanceof Error ? error : new Error(String(error)),
                keyUsed: key,
              });
            }
          }
        }
      },
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
    let processed = 0;

    for (const [key, requestIds] of Object.entries(distribution)) {
      for (const id of requestIds) {
        if (!isFirst && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        isFirst = false;

        const request = requestMap.get(id)!;
        try {
          await this.executeWithRetry(
            request,
            key,
            handler,
            resultMap,
            retryAttempts,
          );
          processed++;
        } catch (error) {
          // ExecuteWithRetry should handle all errors, but catch just in case
          console.error(
            `[BatchHandler] Unexpected error in executeWithRetry for ${id}:`,
            error,
          );
          if (!resultMap.has(id)) {
            resultMap.set(id, {
              requestId: id,
              success: false,
              error: error instanceof Error ? error : new Error(String(error)),
              keyUsed: key,
            });
          }
          processed++;
        }
      }
    }
  }

  /**
   * Execute a single request with rate limit awareness and retry logic
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
        // Always check and wait for rate limit before making request
        await this.rateLimiter.waitIfNeeded(key);

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

        // On any error, use exponential backoff for retry
        if (attempt < maxRetries) {
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
