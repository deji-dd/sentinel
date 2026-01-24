/**
 * Database-backed rate limiter for Torn API requests.
 * Ensures we stay well under the 100 requests/min limit from Torn.
 * Persists state across restarts.
 */

import { waitIfRateLimited } from "./rate-limit-state.js";
import {
  recordRequest,
  getRequestCount,
  getOldestRequestInWindow,
  cleanupOldRequests,
} from "./rate-limit-tracker.js";

interface RateLimitConfig {
  maxRequests: number; // Max requests per interval
  intervalMs: number; // Time window in milliseconds
}

class RateLimiter {
  private config: RateLimitConfig;
  private lastCleanup: number = 0;
  private cleanupInterval: number = 30000; // Cleanup every 30s

  constructor(maxRequests: number, intervalMs: number) {
    this.config = { maxRequests, intervalMs };
  }

  /**
   * Wait if necessary to ensure we don't exceed rate limit.
   * Uses database-backed sliding window.
   */
  async waitIfNeeded(): Promise<void> {
    // First check global rate limit state (from actual 429 errors)
    await waitIfRateLimited();

    // Periodic cleanup of old requests
    const now = Date.now();
    if (now - this.lastCleanup > this.cleanupInterval) {
      cleanupOldRequests().catch(() => {}); // Fire and forget
      this.lastCleanup = now;
    }

    // Check current request count from database
    const count = await getRequestCount();

    // If we're at the limit, wait until the oldest request expires
    if (count >= this.config.maxRequests) {
      const oldestRequest = await getOldestRequestInWindow();
      if (oldestRequest) {
        const age = now - oldestRequest.getTime();
        const waitTime = this.config.intervalMs - age + 100; // +100ms buffer
        if (waitTime > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          // Recursively check again in case multiple requests need to wait
          return this.waitIfNeeded();
        }
      }
    }

    // Record this request in database
    await recordRequest();
  }
}

// Global rate limiter: 70 requests per minute (conservative, under 100 limit)
// This translates to roughly 1 request per 857ms
export const tornRateLimiter = new RateLimiter(70, 60000); // 70 req/min
