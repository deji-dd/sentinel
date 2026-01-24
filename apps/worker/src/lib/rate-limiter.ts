/**
 * Token bucket rate limiter for Torn API requests.
 * Ensures we stay well under the 100 requests/min limit from Torn.
 */

interface RateLimitConfig {
  maxRequests: number; // Max requests per interval
  intervalMs: number; // Time window in milliseconds
}

class RateLimiter {
  private requests: number[] = []; // Timestamps of recent requests
  private config: RateLimitConfig;

  constructor(maxRequests: number, intervalMs: number) {
    this.config = { maxRequests, intervalMs };
  }

  /**
   * Wait if necessary to ensure we don't exceed rate limit.
   * Uses a sliding window approach.
   */
  async waitIfNeeded(): Promise<void> {
    const now = Date.now();

    // Remove old requests outside the window
    this.requests = this.requests.filter(
      (timestamp) => now - timestamp < this.config.intervalMs,
    );

    // If we're at the limit, wait until the oldest request expires
    if (this.requests.length >= this.config.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.config.intervalMs - (now - oldestRequest) + 10; // +10ms buffer
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        // Recursively check again in case multiple requests need to wait
        return this.waitIfNeeded();
      }
    }

    // Record this request
    this.requests.push(now);
  }
}

// Global rate limiter: 70 requests per minute (conservative, under 100 limit)
// This translates to roughly 1 request per 857ms
export const tornRateLimiter = new RateLimiter(70, 60000); // 70 req/min
