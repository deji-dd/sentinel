/**
 * IP-based Rate Limiting for Assist Endpoints
 * Tracks failed requests per IP to prevent abuse and brute force attacks
 */

type KyselyDb = typeof import("./db-client.js").db;

export const ASSIST_RATE_LIMIT_CONFIG = {
  // IP rate limiting for failed requests
  MAX_FAILURES_PER_HOUR_PER_IP: 50, // Max failed requests from one IP per hour
  IP_BLOCK_DURATION_MS: 3600000, // 1 hour block after threshold
  IP_BLOCK_THRESHOLD: 50, // Consecutive failures before auto-block
  IP_FAILURE_WINDOW_MS: 3600000, // 1 hour window for tracking IP failures

  // Script generation rate limiting per UUID
  // Each script lasts 10 minutes, so hard limit is 1 generation per 10 minutes
  MAX_GENERATIONS_PER_10_MINUTES_PER_UUID: 1, // Max script generations per UUID per 10-minute window
  SCRIPT_GENERATION_RATE_LIMIT_WINDOW_MS: 600000, // 10 minutes
  SCRIPT_GENERATION_BLOCK_DURATION_MS: 600000, // 10 minute block after hitting limit

  // Failure tracking
  CONSECUTIVE_FAILURES_THRESHOLD: 20, // Track consecutive failures for auto-blacklisting
};

export interface AssistIPRateLimiter {
  isIPBlocked(ip: string): Promise<boolean>;
  recordFailure(
    ip: string,
    errorType: string,
    uuid?: string,
    path?: string,
    userAgent?: string,
  ): Promise<void>;
  recordSuccessfulGeneration(
    uuid: string,
    ip: string,
    tornId?: number,
  ): Promise<void>;
  isUUIDRateLimited(uuid: string, tornId?: number): Promise<boolean>;
  canBypassRateLimit(tornId?: number): boolean;
  getIPFailureCount(ip: string): Promise<number>;
  getUUIDGenerationCount(uuid: string, windowMs?: number): Promise<number>;
  blockIP(ip: string, reason: string, durationMs?: number): Promise<void>;
  blockUUID(uuid: string, reason: string, durationMs?: number): Promise<void>;
}

/**
 * Database-backed IP rate limiter for assist endpoints
 */
export class DatabaseIPRateLimiter implements AssistIPRateLimiter {
  private db: KyselyDb;
  private ipRateLimitTable: string;
  private scriptGenerationLimitTable: string;

  constructor(
    db: KyselyDb,
    ipRateLimitTable: string,
    scriptGenerationLimitTable: string,
  ) {
    this.db = db;
    this.ipRateLimitTable = ipRateLimitTable;
    this.scriptGenerationLimitTable = scriptGenerationLimitTable;
  }

  /**
   * Check if an IP is currently blocked
   */
  async isIPBlocked(ip: string): Promise<boolean> {
    const record = await this.db
      .selectFrom(this.ipRateLimitTable as "sentinel_assist_ip_rate_limits")
      .select(["is_blocked", "blocked_until"])
      .where("ip_address", "=", ip)
      .where("is_blocked", "=", 1)
      .orderBy("last_occurrence_at", "desc")
      .executeTakeFirst();

    if (!record) {
      return false;
    }

    // Check if block has expired
    if (record.blocked_until) {
      const blockedUntil = new Date(record.blocked_until).getTime();
      if (blockedUntil <= Date.now()) {
        // Block has expired, unblock it
        await this.db
          .updateTable(
            this.ipRateLimitTable as "sentinel_assist_ip_rate_limits",
          )
          .set({ is_blocked: 0 })
          .where("ip_address", "=", ip)
          .where("is_blocked", "=", 1)
          .execute();
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a torn user can bypass rate limits (admin bypass)
   */
  canBypassRateLimit(tornId?: number): boolean {
    if (!tornId) {
      return false;
    }
    const sentinelUserId = process.env.SENTINEL_USER_ID;
    if (!sentinelUserId) {
      return false;
    }
    // Parse comma-separated list of user IDs
    const allowedIds = sentinelUserId
      .split(",")
      .map((id) => Number.parseInt(id.trim(), 10));
    return allowedIds.includes(tornId);
  }

  /**
   * Check if a UUID is currently rate limited for script generation
   */
  async isUUIDRateLimited(uuid: string, tornId?: number): Promise<boolean> {
    // Check if user can bypass rate limits
    if (this.canBypassRateLimit(tornId)) {
      return false;
    }

    const record = await this.db
      .selectFrom(
        this
          .scriptGenerationLimitTable as "sentinel_assist_script_generation_limits",
      )
      .select(["is_rate_limited", "rate_limit_until"])
      .where("token_uuid", "=", uuid)
      .where("is_rate_limited", "=", 1)
      .executeTakeFirst();

    if (!record) {
      return false;
    }

    // Check if rate limit has expired
    if (record.rate_limit_until) {
      const limitUntil = new Date(record.rate_limit_until).getTime();
      if (limitUntil <= Date.now()) {
        // Rate limit has expired, reset it
        await this.db
          .updateTable(
            this
              .scriptGenerationLimitTable as "sentinel_assist_script_generation_limits",
          )
          .set({ is_rate_limited: 0, generation_count: 0 })
          .where("token_uuid", "=", uuid)
          .execute();
        return false;
      }
    }

    return true;
  }

  /**
   * Record a failed request from an IP
   */
  async recordFailure(
    ip: string,
    errorType: string,
    uuid?: string,
    path?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      const now = new Date().toISOString();

      // Check if this IP/UUID combo already exists
      const existing = await this.db
        .selectFrom(this.ipRateLimitTable as "sentinel_assist_ip_rate_limits")
        .select(["id", "request_count"])
        .where("ip_address", "=", ip)
        .where("uuid", "=", uuid || null)
        .where("error_type", "=", errorType)
        .executeTakeFirst();

      if (existing) {
        // Update existing record
        await this.db
          .updateTable(
            this.ipRateLimitTable as "sentinel_assist_ip_rate_limits",
          )
          .set({
            request_count: existing.request_count + 1,
            last_occurrence_at: now,
          })
          .where("id", "=", existing.id)
          .execute();
      } else {
        // Insert new record
        await this.db
          .insertInto(this.ipRateLimitTable as "sentinel_assist_ip_rate_limits")
          .values({
            ip_address: ip,
            uuid: uuid || null,
            error_type: errorType,
            request_path: path || "",
            user_agent: userAgent || null,
            request_count: 1,
            first_occurrence_at: now,
            last_occurrence_at: now,
            is_blocked: 0,
            blocked_reason: null,
            blocked_until: null,
          })
          .execute();
      }

      // Check if we should auto-block this IP
      const failureCount = await this.getIPFailureCount(ip);
      if (
        failureCount >= ASSIST_RATE_LIMIT_CONFIG.IP_BLOCK_THRESHOLD &&
        !(await this.isIPBlocked(ip))
      ) {
        await this.blockIP(
          ip,
          `Auto-blocked after ${failureCount} failures`,
          ASSIST_RATE_LIMIT_CONFIG.IP_BLOCK_DURATION_MS,
        );
      }

      // Update UUID failure tracking if provided
      if (uuid) {
        await this.updateUUIDFailureTracking(uuid, now);
      }
    } catch (error) {
      console.error("[AssistIPRateLimiter] Error recording failure:", error);
      throw error;
    }
  }

  /**
   * Record a successful script generation for a UUID
   */
  async recordSuccessfulGeneration(
    uuid: string,
    ip: string,
    tornId?: number,
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      const windowStartMs =
        Date.now() -
        ASSIST_RATE_LIMIT_CONFIG.SCRIPT_GENERATION_RATE_LIMIT_WINDOW_MS;

      // Check if limit record exists
      const existing = await this.db
        .selectFrom(
          this
            .scriptGenerationLimitTable as "sentinel_assist_script_generation_limits",
        )
        .select(["id", "generation_count", "last_generation_at"])
        .where("token_uuid", "=", uuid)
        .executeTakeFirst();

      let windowGenerationCount = 1;

      if (existing) {
        const lastGenerationMs = existing.last_generation_at
          ? new Date(existing.last_generation_at).getTime()
          : 0;
        const isSameWindow =
          Number.isFinite(lastGenerationMs) &&
          lastGenerationMs >= windowStartMs;
        windowGenerationCount = isSameWindow
          ? existing.generation_count + 1
          : 1;

        // Update existing record
        await this.db
          .updateTable(
            this
              .scriptGenerationLimitTable as "sentinel_assist_script_generation_limits",
          )
          .set({
            generation_count: windowGenerationCount,
            last_generation_at: now,
            last_generation_ip: ip,
            consecutive_failures: 0,
            updated_at: now,
          })
          .where("id", "=", existing.id)
          .execute();
      } else {
        // Insert new record
        await this.db
          .insertInto(
            this
              .scriptGenerationLimitTable as "sentinel_assist_script_generation_limits",
          )
          .values({
            token_uuid: uuid,
            generation_count: 1,
            last_generation_at: now,
            last_generation_ip: ip,
            consecutive_failures: 0,
            last_failure_at: null,
            is_rate_limited: 0,
            rate_limit_until: null,
            updated_at: now,
          })
          .execute();
      }

      if (
        windowGenerationCount >
          ASSIST_RATE_LIMIT_CONFIG.MAX_GENERATIONS_PER_10_MINUTES_PER_UUID &&
        !(await this.isUUIDRateLimited(uuid, tornId))
      ) {
        await this.blockUUID(
          uuid,
          `Rate limit exceeded: ${windowGenerationCount} generations per 10 minutes`,
          ASSIST_RATE_LIMIT_CONFIG.SCRIPT_GENERATION_BLOCK_DURATION_MS,
        );
      }
    } catch (error) {
      console.error(
        "[AssistIPRateLimiter] Error recording successful generation:",
        error,
      );
      throw error;
    }
  }

  /**
   * Get the count of failures for an IP in the last hour
   */
  async getIPFailureCount(ip: string): Promise<number> {
    const oneHourAgo = new Date(
      Date.now() - ASSIST_RATE_LIMIT_CONFIG.IP_FAILURE_WINDOW_MS,
    ).toISOString();

    const rows = await this.db
      .selectFrom(this.ipRateLimitTable as "sentinel_assist_ip_rate_limits")
      .select(["request_count"])
      .where("ip_address", "=", ip)
      .where("last_occurrence_at", ">=", oneHourAgo)
      .execute();

    return rows.reduce((sum, row) => sum + row.request_count, 0);
  }

  /**
   * Get the count of generations for a UUID in a given time window
   */
  async getUUIDGenerationCount(
    uuid: string,
    windowMs: number = ASSIST_RATE_LIMIT_CONFIG.SCRIPT_GENERATION_RATE_LIMIT_WINDOW_MS,
  ): Promise<number> {
    const limiterRecord = await this.db
      .selectFrom(
        this
          .scriptGenerationLimitTable as "sentinel_assist_script_generation_limits",
      )
      .select(["generation_count", "last_generation_at"])
      .where("token_uuid", "=", uuid)
      .executeTakeFirst();

    if (!limiterRecord) {
      return 0;
    }

    // If the last generation was outside the window, count is 0
    if (limiterRecord.last_generation_at) {
      const lastGenTime = new Date(limiterRecord.last_generation_at).getTime();
      const windowStart = Date.now() - windowMs;
      if (lastGenTime < windowStart) {
        return 0;
      }
    }

    return limiterRecord.generation_count;
  }

  /**
   * Block an IP for a specified duration
   */
  async blockIP(
    ip: string,
    reason: string,
    durationMs?: number,
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      const blockedUntil = new Date(
        Date.now() +
          (durationMs || ASSIST_RATE_LIMIT_CONFIG.IP_BLOCK_DURATION_MS),
      ).toISOString();

      // Check if IP already has a record
      const existing = await this.db
        .selectFrom(this.ipRateLimitTable as "sentinel_assist_ip_rate_limits")
        .select(["id"])
        .where("ip_address", "=", ip)
        .where("is_blocked", "=", 1)
        .executeTakeFirst();

      if (existing) {
        await this.db
          .updateTable(
            this.ipRateLimitTable as "sentinel_assist_ip_rate_limits",
          )
          .set({
            is_blocked: 1,
            blocked_reason: reason,
            blocked_until: blockedUntil,
            last_occurrence_at: now,
          })
          .where("id", "=", existing.id)
          .execute();
      } else {
        await this.db
          .insertInto(this.ipRateLimitTable as "sentinel_assist_ip_rate_limits")
          .values({
            ip_address: ip,
            uuid: null,
            error_type: "BLOCKED",
            request_path: "",
            user_agent: null,
            request_count: 1,
            first_occurrence_at: now,
            last_occurrence_at: now,
            is_blocked: 1,
            blocked_reason: reason,
            blocked_until: blockedUntil,
          })
          .execute();
      }

      console.log(`[AssistIPRateLimiter] Blocked IP ${ip}: ${reason}`);
    } catch (error) {
      console.error("[AssistIPRateLimiter] Error blocking IP:", error);
      throw error;
    }
  }

  /**
   * Block a UUID for a specified duration
   */
  async blockUUID(
    uuid: string,
    reason: string,
    durationMs?: number,
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      const limitUntil = new Date(
        Date.now() +
          (durationMs ||
            ASSIST_RATE_LIMIT_CONFIG.SCRIPT_GENERATION_BLOCK_DURATION_MS),
      ).toISOString();

      // Check if UUID already has a record
      const existing = await this.db
        .selectFrom(
          this
            .scriptGenerationLimitTable as "sentinel_assist_script_generation_limits",
        )
        .select(["id"])
        .where("token_uuid", "=", uuid)
        .executeTakeFirst();

      if (existing) {
        await this.db
          .updateTable(
            this
              .scriptGenerationLimitTable as "sentinel_assist_script_generation_limits",
          )
          .set({
            is_rate_limited: 1,
            rate_limit_until: limitUntil,
            updated_at: now,
          })
          .where("id", "=", existing.id)
          .execute();
      } else {
        await this.db
          .insertInto(
            this
              .scriptGenerationLimitTable as "sentinel_assist_script_generation_limits",
          )
          .values({
            token_uuid: uuid,
            generation_count: 0,
            last_generation_at: null,
            last_generation_ip: null,
            consecutive_failures: 0,
            last_failure_at: null,
            is_rate_limited: 1,
            rate_limit_until: limitUntil,
            updated_at: now,
          })
          .execute();
      }

      console.log(`[AssistIPRateLimiter] Rate limited UUID ${uuid}: ${reason}`);
    } catch (error) {
      console.error("[AssistIPRateLimiter] Error rate limiting UUID:", error);
      throw error;
    }
  }

  /**
   * Internal: Update failure tracking for a UUID
   */
  private async updateUUIDFailureTracking(
    uuid: string,
    now: string,
  ): Promise<void> {
    const existing = await this.db
      .selectFrom(
        this
          .scriptGenerationLimitTable as "sentinel_assist_script_generation_limits",
      )
      .select(["id", "consecutive_failures"])
      .where("token_uuid", "=", uuid)
      .executeTakeFirst();

    if (existing) {
      const newFailures = existing.consecutive_failures + 1;
      await this.db
        .updateTable(
          this
            .scriptGenerationLimitTable as "sentinel_assist_script_generation_limits",
        )
        .set({
          consecutive_failures: newFailures,
          last_failure_at: now,
          updated_at: now,
        })
        .where("id", "=", existing.id)
        .execute();
    } else {
      await this.db
        .insertInto(
          this
            .scriptGenerationLimitTable as "sentinel_assist_script_generation_limits",
        )
        .values({
          token_uuid: uuid,
          generation_count: 0,
          last_generation_at: null,
          last_generation_ip: null,
          consecutive_failures: 1,
          last_failure_at: now,
          is_rate_limited: 0,
          rate_limit_until: null,
          updated_at: now,
        })
        .execute();
    }
  }
}
