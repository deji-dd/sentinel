/**
 * Per-User cooldown tracker with randomized jitter.
 */
export class UserCooldownManager {
  private userCooldownUntil = new Map<string | number, number>();

  private nowMs(): number {
    return Date.now();
  }

  private withJitter(waitMs: number, jitterMaxMs: number): number {
    const safeWait = Math.max(0, waitMs);
    const safeJitter = Math.max(0, jitterMaxMs);
    if (safeJitter === 0) return safeWait;
    const jitter = Math.floor(Math.random() * (safeJitter + 1));
    return safeWait + jitter;
  }

  private cleanupExpiredCooldowns(): void {
    const now = this.nowMs();
    for (const [userId, until] of this.userCooldownUntil.entries()) {
      if (until <= now) {
        this.userCooldownUntil.delete(userId);
      }
    }
  }

  /**
   * Sets a cooldown for a specific user ID with randomized jitter.
   */
  setUserCooldown(
    userId: string | number,
    waitMs: number,
    jitterMaxMs = 350,
  ): void {
    this.cleanupExpiredCooldowns();
    const until = this.nowMs() + this.withJitter(waitMs, jitterMaxMs);
    this.userCooldownUntil.set(userId, until);
  }

  /**
   * Returns remaining cooldown milliseconds for a user ID (0 if active/ready).
   */
  getUserCooldownRemainingMs(userId: string | number): number {
    this.cleanupExpiredCooldowns();
    const until = this.userCooldownUntil.get(userId) || 0;
    return Math.max(0, until - this.nowMs());
  }

  /**
   * Pauses execution if the given user is currently on cooldown.
   */
  async waitIfInCooldown(userId: string | number): Promise<void> {
    const remaining = this.getUserCooldownRemainingMs(userId);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }
}
