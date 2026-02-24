/**
 * Per-User Rate Limiting for Torn API
 * Tracks requests per USER (not per key) to enforce Torn's actual limit:
 * Each user gets 100 requests/minute across ALL their API keys
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimitTracker } from "./torn.js";
import { hashApiKey } from "./api-key-manager.js";
import { RATE_LIMITING } from "./constants.js";

export interface PerUserRateLimiterConfig {
  supabase: SupabaseClient;
  tableName: string;
  apiKeyMappingTableName: string;
  hashPepper: string;
  maxRequestsPerWindow?: number;
  windowMs?: number;
}

/**
 * Per-user rate limiter that enforces Torn's actual limit:
 * 100 requests per minute per USER across all their keys
 *
 * This replaces the old per-key rate limiter which incorrectly
 * allowed multiple keys to have independent 50 req/min limits.
 */
export class PerUserRateLimiter implements RateLimitTracker {
  private supabase: SupabaseClient;
  private tableName: string;
  private apiKeyMappingTableName: string;
  private hashPepper: string;
  private maxRequests: number;
  private windowMs: number;
  private logEnabled: boolean;
  private userIdCache: Map<string, number> = new Map();
  private unmappedKeysWarned: Set<string> = new Set(); // Track warned keys to avoid spam
  private requestCounter: number = 0; // Counter for logging every Nth request

  constructor(config: PerUserRateLimiterConfig) {
    this.supabase = config.supabase;
    this.tableName = config.tableName;
    this.apiKeyMappingTableName = config.apiKeyMappingTableName;
    this.hashPepper = config.hashPepper;
    this.maxRequests =
      config.maxRequestsPerWindow ?? RATE_LIMITING.MAX_REQUESTS_PER_MINUTE;
    this.windowMs = config.windowMs ?? RATE_LIMITING.WINDOW_MS;
    this.logEnabled = process.env.RATE_LIMIT_LOG === "1";

    if (!this.hashPepper) {
      throw new Error(
        "API_KEY_HASH_PEPPER is required for secure rate limiting",
      );
    }
  }

  private formatTimestamp(): string {
    return new Date().toISOString().split("T")[1].split(".")[0];
  }

  private formatWindowTimeLeft(oldestRequest: Date | null): string {
    if (!oldestRequest) {
      return `${(this.windowMs / 1000).toFixed(1)}s`;
    }

    const elapsedMs = Date.now() - oldestRequest.getTime();
    const remainingMs = Math.max(0, this.windowMs - elapsedMs);
    return `${(remainingMs / 1000).toFixed(1)}s`;
  }

  private async getRequestCountForUser(userId: number): Promise<number> {
    const windowStart = new Date(Date.now() - this.windowMs);

    try {
      const { count, error } = await this.supabase
        .from(this.tableName)
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("requested_at", windowStart.toISOString());

      if (error) {
        console.error(
          `[RateLimiter] Failed to count requests for user ${userId} from table ${this.tableName}:`,
          {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
            fullError: error,
          },
        );
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error(
        `[RateLimiter] Exception while counting requests for user ${userId}:`,
        error,
      );
      return 0;
    }
  }

  private async getOldestRequestForUser(userId: number): Promise<Date | null> {
    const windowStart = new Date(Date.now() - this.windowMs);

    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select("requested_at")
        .eq("user_id", userId)
        .gte("requested_at", windowStart.toISOString())
        .order("requested_at", { ascending: true })
        .limit(1)
        .single();

      if (error || !data) {
        return null;
      }

      return new Date((data as any).requested_at);
    } catch {
      return null;
    }
  }

  /**
   * Resolve user ID from API key by looking up in mapping table
   * Caches result for performance within a batch operation
   * Throws error if mapping not found - rate limiting is non-negotiable
   */
  private async getUserIdFromApiKey(apiKey: string): Promise<number | null> {
    const keyHash = hashApiKey(apiKey, this.hashPepper);

    // Check cache first
    if (this.userIdCache.has(keyHash)) {
      return this.userIdCache.get(keyHash) || null;
    }

    try {
      const { data, error } = await this.supabase
        .from(this.apiKeyMappingTableName)
        .select("user_id")
        .eq("api_key_hash", keyHash)
        .is("deleted_at", null)
        .single();

      if (error || !data) {
        // Throw error instead of silently failing - rate limiting is non-negotiable
        throw new Error(
          `API key not mapped to a user. Call ensureApiKeyMapped() during initialization. ` +
            `This is a critical safety feature to prevent API key blocking.`,
        );
      }

      const userId = Number((data as any).user_id);
      this.userIdCache.set(keyHash, userId);
      return userId;
    } catch (error) {
      // Re-throw to ensure we don't silently fail
      throw error;
    }
  }

  /**
   * Record a new request for a user
   * User ID is resolved from the API key
   */
  async recordRequest(apiKey: string): Promise<void> {
    const userId = await this.getUserIdFromApiKey(apiKey);
    if (!userId) {
      // Silent return for system keys or keys not in mapping (expected)
      return;
    }

    const now = new Date();
    const keyHash = hashApiKey(apiKey, this.hashPepper);

    try {
      await this.supabase.from(this.tableName).insert({
        user_id: userId,
        api_key_hash: keyHash,
        requested_at: now.toISOString(),
      });

      if (this.logEnabled) {
        this.requestCounter++;
        // Only log every 10th request to reduce verbosity
        if (this.requestCounter % 10 === 0) {
          const count = await this.getRequestCountForUser(userId);
          const oldestRequest = await this.getOldestRequestForUser(userId);
          const timestamp = this.formatTimestamp();
          console.log(
            `[rate_limiter] ${timestamp} Recorded request ${count}/${this.maxRequests} for user ${userId} (${this.formatWindowTimeLeft(oldestRequest)} left in window)`,
          );
        }
      }
    } catch (error) {
      console.error("[rate_limiter] Failed to record request:", error);
      throw error;
    }
  }

  /**
   * Get request count for a user in the current window
   * User ID is resolved from the API key
   */
  async getRequestCount(apiKey: string): Promise<number> {
    const userId = await this.getUserIdFromApiKey(apiKey);
    if (!userId) {
      // System keys or unmapped keys return 0 (not rate limited)
      return 0;
    }

    return this.getRequestCountForUser(userId);
  }

  /**
   * Check if a user is rate limited
   */
  async isRateLimited(apiKey: string): Promise<boolean> {
    const count = await this.getRequestCount(apiKey);
    return count >= this.maxRequests;
  }

  /**
   * Get oldest request timestamp for a user in current window
   */
  async getOldestRequest(apiKey: string): Promise<Date | null> {
    const userId = await this.getUserIdFromApiKey(apiKey);
    if (!userId) {
      return null;
    }

    return this.getOldestRequestForUser(userId);
  }

  /**
   * Clean up old request records
   */
  async cleanupOldRequests(): Promise<void> {
    const windowStart = new Date(Date.now() - this.windowMs);

    try {
      await this.supabase
        .from(this.tableName)
        .delete()
        .lt("requested_at", windowStart.toISOString());
    } catch (error) {
      console.error("[RateLimiter] Failed to cleanup:", error);
    }
  }

  /**
   * Wait if necessary to ensure we don't exceed per-user rate limit
   */
  async waitIfNeeded(apiKey: string): Promise<void> {
    // Periodic cleanup
    this.cleanupOldRequests().catch(() => {});

    const userId = await this.getUserIdFromApiKey(apiKey);
    if (!userId) {
      return;
    }

    const count = await this.getRequestCountForUser(userId);

    if (count >= this.maxRequests) {
      const oldestRequest = await this.getOldestRequestForUser(userId);
      if (oldestRequest) {
        const now = Date.now();
        const age = now - oldestRequest.getTime();
        const waitTime = this.windowMs - age + 100; // +100ms buffer
        if (waitTime > 0) {
          const timestamp = this.formatTimestamp();
          console.log(
            `[rate_limiter] ${timestamp} User ${userId} rate limited. Waiting ${waitTime}ms before retry.`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          // Recursively check again
          return this.waitIfNeeded(apiKey);
        }
      }
    }
  }

  /**
   * Clear the user ID cache (call between batch operations)
   */
  clearCache(): void {
    this.userIdCache.clear();
  }

  /**
   * Get max requests per window
   */
  getMaxRequests(): number {
    return this.maxRequests;
  }

  /**
   * Set max requests per window (for per-user overrides)
   */
  setMaxRequests(max: number): void {
    this.maxRequests = max;
  }
}
