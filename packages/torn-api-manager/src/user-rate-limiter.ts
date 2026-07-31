const WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 50;

/**
 * Per-User sliding window RAM rate limiter.
 * Tracks requests by `userId` in memory within worker_v2.
 */
export class UserRateLimiter {
  private userRequestsMap = new Map<string | number, number[]>();
  private maxRequestsPerWindow: number;
  private windowMs: number;
  private lastCleanupAt = 0;

  constructor(
    maxRequestsPerWindow = DEFAULT_MAX_REQUESTS_PER_WINDOW,
    windowMs = WINDOW_MS,
  ) {
    this.maxRequestsPerWindow = maxRequestsPerWindow;
    this.windowMs = windowMs;
  }

  /**
   * Pauses execution if the given userId has hit their sliding window rate limit.
   */
  async waitIfNeeded(userId: string | number): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanupAt >= 30_000) {
      this.lastCleanupAt = now;
      this.cleanupOldRequests();
    }

    while (true) {
      const timestamps = this.userRequestsMap.get(userId) || [];
      const active = timestamps.filter((t) => t >= Date.now() - this.windowMs);

      if (active.length < this.maxRequestsPerWindow) {
        this.recordRequest(userId);
        return;
      }

      const oldest = active[0];
      const waitTime = this.windowMs - (Date.now() - oldest) + 100;

      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }
    }
  }

  /**
   * Records a request timestamp for a given userId.
   */
  recordRequest(userId: string | number): void {
    const now = Date.now();
    const timestamps = this.userRequestsMap.get(userId) || [];
    timestamps.push(now);
    this.userRequestsMap.set(userId, timestamps);
  }

  /**
   * Returns current active request count for a userId in the current window.
   */
  getRequestCount(userId: string | number): number {
    const now = Date.now();
    const timestamps = this.userRequestsMap.get(userId) || [];
    return timestamps.filter((t) => t >= now - this.windowMs).length;
  }

  /**
   * Removes stale request timestamps older than windowMs.
   */
  private cleanupOldRequests(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [userId, timestamps] of this.userRequestsMap.entries()) {
      const active = timestamps.filter((t) => t >= windowStart);
      if (active.length === 0) {
        this.userRequestsMap.delete(userId);
      } else {
        this.userRequestsMap.set(userId, active);
      }
    }
  }
}
