/**
 * IP-based Rate Limiting for Assist Endpoints
 * Tracks failed requests per IP to prevent abuse and brute force attacks
 */

import type { Database } from "better-sqlite3";

type IPRateLimitRecord = {
  id: number;
  ip_address: string;
  uuid: string | null;
  error_type: string;
  request_path: string;
  user_agent: string | null;
  request_count: number;
  first_occurrence_at: string;
  last_occurrence_at: string;
  is_blocked: number;
  blocked_reason: string | null;
  blocked_until: string | null;
};

type ScriptGenerationLimitRecord = {
  id: number;
  token_uuid: string;
  generation_count: number;
  last_generation_at: string | null;
  last_generation_ip: string | null;
  consecutive_failures: number;
  last_failure_at: string | null;
  is_rate_limited: number;
  rate_limit_until: string | null;
  created_at: string;
  updated_at: string;
};

export const ASSIST_RATE_LIMIT_CONFIG = {
  // IP rate limiting for failed requests
  MAX_FAILURES_PER_HOUR_PER_IP: 50, // Max failed requests from one IP per hour
  IP_BLOCK_DURATION_MS: 3600000, // 1 hour block after threshold
  IP_BLOCK_THRESHOLD: 50, // Consecutive failures before auto-block

  // Script generation rate limiting per UUID
  MAX_GENERATIONS_PER_MINUTE_PER_UUID: 10, // Max script generations per UUID per minute
  MAX_GENERATIONS_PER_HOUR_PER_UUID: 100, // Max script generations per UUID per hour
  SCRIPT_GENERATION_RATE_LIMIT_WINDOW_MS: 60000, // 1 minute
  SCRIPT_GENERATION_HOURLY_WINDOW_MS: 3600000, // 1 hour
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
  recordSuccessfulGeneration(uuid: string, ip: string): Promise<void>;
  isUUIDRateLimited(uuid: string): Promise<boolean>;
  getIPFailureCount(ip: string): Promise<number>;
  getUUIDGenerationCount(uuid: string, windowMs?: number): Promise<number>;
  blockIP(ip: string, reason: string, durationMs?: number): Promise<void>;
  blockUUID(uuid: string, reason: string, durationMs?: number): Promise<void>;
}

/**
 * Database-backed IP rate limiter for assist endpoints
 */
export class DatabaseIPRateLimiter implements AssistIPRateLimiter {
  private db: Database;
  private ipRateLimitTable: string;
  private scriptGenerationLimitTable: string;

  constructor(
    db: Database,
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
    const record = this.db
      .prepare(
        `
      SELECT is_blocked, blocked_until FROM ${this.ipRateLimitTable}
      WHERE ip_address = ? AND is_blocked = 1
      LIMIT 1
    `,
      )
      .get(ip) as (IPRateLimitRecord & { outcome: "success" }) | undefined;

    if (!record) {
      return false;
    }

    // Check if block has expired
    if (record.blocked_until) {
      const blockedUntil = new Date(record.blocked_until).getTime();
      if (blockedUntil <= Date.now()) {
        // Block has expired, unblock it
        this.db
          .prepare(
            `UPDATE ${this.ipRateLimitTable} SET is_blocked = 0 WHERE ip_address = ?`,
          )
          .run(ip);
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a UUID is currently rate limited for script generation
   */
  async isUUIDRateLimited(uuid: string): Promise<boolean> {
    const record = this.db
      .prepare(
        `
      SELECT is_rate_limited, rate_limit_until FROM ${this.scriptGenerationLimitTable}
      WHERE token_uuid = ? AND is_rate_limited = 1
      LIMIT 1
    `,
      )
      .get(uuid) as (ScriptGenerationLimitRecord & { outcome: "success" }) | undefined;

    if (!record) {
      return false;
    }

    // Check if rate limit has expired
    if (record.rate_limit_until) {
      const limitUntil = new Date(record.rate_limit_until).getTime();
      if (limitUntil <= Date.now()) {
        // Rate limit has expired, reset it
        this.db
          .prepare(
            `UPDATE ${this.scriptGenerationLimitTable} 
           SET is_rate_limited = 0, generation_count = 0 
           WHERE token_uuid = ?`,
          )
          .run(uuid);
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
      const existing = this.db
        .prepare(
          `
        SELECT id, request_count, consecutive_failures FROM ${this.ipRateLimitTable}
        WHERE ip_address = ? AND uuid = ? AND error_type = ?
        LIMIT 1
      `,
        )
        .get(ip, uuid || null, errorType) as
        | (IPRateLimitRecord & { consecutive_failures?: number })
        | undefined;

      if (existing) {
        // Update existing record
        this.db
          .prepare(
            `
          UPDATE ${this.ipRateLimitTable}
          SET request_count = request_count + 1,
              last_occurrence_at = ?
          WHERE id = ?
        `,
          )
          .run(now, existing.id);
      } else {
        // Insert new record
        this.db
          .prepare(
            `
          INSERT INTO ${this.ipRateLimitTable} (
            ip_address, uuid, error_type, request_path, user_agent,
            first_occurrence_at, last_occurrence_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(ip, uuid || null, errorType, path || null, userAgent || null, now, now);
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
        this.updateUUIDFailureTracking(uuid, now);
      }
    } catch (error) {
      console.error("[AssistIPRateLimiter] Error recording failure:", error);
      throw error;
    }
  }

  /**
   * Record a successful script generation for a UUID
   */
  async recordSuccessfulGeneration(uuid: string, ip: string): Promise<void> {
    try {
      const now = new Date().toISOString();

      // Check if limit record exists
      const existing = this.db
        .prepare(
          `
        SELECT id FROM ${this.scriptGenerationLimitTable}
        WHERE token_uuid = ?
        LIMIT 1
      `,
        )
        .get(uuid) as { id: number } | undefined;

      if (existing) {
        // Update existing record
        this.db
          .prepare(
            `
          UPDATE ${this.scriptGenerationLimitTable}
          SET generation_count = generation_count + 1,
              last_generation_at = ?,
              last_generation_ip = ?,
              consecutive_failures = 0,
              updated_at = ?
          WHERE id = ?
        `,
          )
          .run(now, ip, now, existing.id);
      } else {
        // Insert new record
        this.db
          .prepare(
            `
          INSERT INTO ${this.scriptGenerationLimitTable} (
            token_uuid, generation_count, last_generation_at, last_generation_ip, updated_at
          ) VALUES (?, 1, ?, ?, ?)
        `,
          )
          .run(uuid, now, ip, now);
      }

      // Check if we should rate limit based on generation count
      const generationCount = await this.getUUIDGenerationCount(
        uuid,
        ASSIST_RATE_LIMIT_CONFIG.SCRIPT_GENERATION_RATE_LIMIT_WINDOW_MS,
      );

      if (
        generationCount > ASSIST_RATE_LIMIT_CONFIG.MAX_GENERATIONS_PER_MINUTE_PER_UUID &&
        !(await this.isUUIDRateLimited(uuid))
      ) {
        await this.blockUUID(
          uuid,
          `Rate limit exceeded: ${generationCount} generations per minute`,
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
      Date.now() - ASSIST_RATE_LIMIT_CONFIG.SCRIPT_GENERATION_HOURLY_WINDOW_MS,
    ).toISOString();

    const result = this.db
      .prepare(
        `
      SELECT COALESCE(SUM(request_count), 0) as total
      FROM ${this.ipRateLimitTable}
      WHERE ip_address = ? AND last_occurrence_at >= ?
    `,
      )
      .get(ip, oneHourAgo) as { total: number };

    return result.total;
  }

  /**
   * Get the count of generations for a UUID in a given time window
   */
  async getUUIDGenerationCount(
    uuid: string,
    windowMs: number = ASSIST_RATE_LIMIT_CONFIG.SCRIPT_GENERATION_RATE_LIMIT_WINDOW_MS,
  ): Promise<number> {
    const record = this.db
      .prepare(
        `
      SELECT COUNT(*) as count, last_generation_at
      FROM (
        -- For now, we'll track via a simple counter in the script_generation table
        -- In the future, this could be expanded to track individual requests
      )
    `,
      )
      .get() as { count: number; last_generation_at: string | null };

    const limiterRecord = this.db
      .prepare(
        `
      SELECT generation_count, last_generation_at
      FROM ${this.scriptGenerationLimitTable}
      WHERE token_uuid = ?
      LIMIT 1
    `,
      )
      .get(uuid) as
      | {
          generation_count: number;
          last_generation_at: string | null;
        }
      | undefined;

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
  async blockIP(ip: string, reason: string, durationMs?: number): Promise<void> {
    try {
      const now = new Date().toISOString();
      const blockedUntil = new Date(
        Date.now() + (durationMs || ASSIST_RATE_LIMIT_CONFIG.IP_BLOCK_DURATION_MS),
      ).toISOString();

      // Check if IP already has a record
      const existing = this.db
        .prepare(
          `
        SELECT id FROM ${this.ipRateLimitTable}
        WHERE ip_address = ? AND is_blocked = 1
        LIMIT 1
      `,
        )
        .get(ip) as { id: number } | undefined;

      if (existing) {
        this.db
          .prepare(
            `
          UPDATE ${this.ipRateLimitTable}
          SET is_blocked = 1, blocked_reason = ?, blocked_until = ?
          WHERE id = ?
        `,
          )
          .run(reason, blockedUntil, existing.id);
      } else {
        this.db
          .prepare(
            `
          INSERT INTO ${this.ipRateLimitTable} (
            ip_address, error_type, is_blocked, blocked_reason, blocked_until,
            first_occurrence_at, last_occurrence_at
          ) VALUES (?, ?, 1, ?, ?, ?, ?)
        `,
          )
          .run(ip, "BLOCKED", reason, blockedUntil, now, now);
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
  async blockUUID(uuid: string, reason: string, durationMs?: number): Promise<void> {
    try {
      const now = new Date().toISOString();
      const limitUntil = new Date(
        Date.now() +
          (durationMs ||
            ASSIST_RATE_LIMIT_CONFIG.SCRIPT_GENERATION_BLOCK_DURATION_MS),
      ).toISOString();

      // Check if UUID already has a record
      const existing = this.db
        .prepare(
          `
        SELECT id FROM ${this.scriptGenerationLimitTable}
        WHERE token_uuid = ?
        LIMIT 1
      `,
        )
        .get(uuid) as { id: number } | undefined;

      if (existing) {
        this.db
          .prepare(
            `
          UPDATE ${this.scriptGenerationLimitTable}
          SET is_rate_limited = 1, rate_limit_until = ?, updated_at = ?
          WHERE id = ?
        `,
          )
          .run(limitUntil, now, existing.id);
      } else {
        this.db
          .prepare(
            `
          INSERT INTO ${this.scriptGenerationLimitTable} (
            token_uuid, is_rate_limited, rate_limit_until
          ) VALUES (?, 1, ?)
        `,
          )
          .run(uuid, limitUntil);
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
  private updateUUIDFailureTracking(uuid: string, now: string): void {
    const existing = this.db
      .prepare(
        `
      SELECT id, consecutive_failures FROM ${this.scriptGenerationLimitTable}
      WHERE token_uuid = ?
      LIMIT 1
    `,
      )
      .get(uuid) as { id: number; consecutive_failures: number } | undefined;

    if (existing) {
      const newFailures = existing.consecutive_failures + 1;
      this.db
        .prepare(
          `
        UPDATE ${this.scriptGenerationLimitTable}
        SET consecutive_failures = ?, last_failure_at = ?, updated_at = ?
        WHERE id = ?
      `,
        )
        .run(newFailures, now, now, existing.id);
    } else {
      this.db
        .prepare(
          `
        INSERT INTO ${this.scriptGenerationLimitTable} (
          token_uuid, consecutive_failures, last_failure_at
        ) VALUES (?, 1, ?)
      `,
        )
        .run(uuid, now);
    }
  }
}
