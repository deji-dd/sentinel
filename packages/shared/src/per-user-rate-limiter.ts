/**
 * Per-User Rate Limiting for Torn API
 * Tracks requests per USER (not per key) to enforce Torn's actual limit:
 * Each user gets 100 requests/minute across ALL their API keys
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimitTracker } from "./torn.js";
import { hashApiKey } from "./api-key-manager.js";

const DEFAULT_WINDOW_MS = 60000; // 1 minute window
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 100; // Torn API limit per user

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
  private userIdCache: Map<string, string> = new Map();

  constructor(config: PerUserRateLimiterConfig) {
    this.supabase = config.supabase;
    this.tableName = config.tableName;
    this.apiKeyMappingTableName = config.apiKeyMappingTableName;
    this.hashPepper = config.hashPepper;
    this.maxRequests =
      config.maxRequestsPerWindow ?? DEFAULT_MAX_REQUESTS_PER_WINDOW;
    this.windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;

    if (!this.hashPepper) {
      throw new Error(
        "API_KEY_HASH_PEPPER is required for secure rate limiting",
      );
    }
  }

  /**
   * Resolve user ID from API key by looking up in mapping table
   * Caches result for performance within a batch operation
   */
  private async getUserIdFromApiKey(apiKey: string): Promise<string | null> {
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
        console.warn(
          "[RateLimiter] Could not resolve user_id for api_key_hash:",
          keyHash,
        );
        return null;
      }

      const userId = (data as any).user_id;
      this.userIdCache.set(keyHash, userId);
      return userId;
    } catch (error) {
      console.error("[RateLimiter] Error resolving user_id:", error);
      return null;
    }
  }

  /**
   * Record a new request for a user
   * User ID is resolved from the API key
   */
  async recordRequest(apiKey: string): Promise<void> {
    const userId = await this.getUserIdFromApiKey(apiKey);
    if (!userId) {
      console.warn(
        "[RateLimiter] Could not record request - user_id not found",
      );
      return;
    }

    const now = new Date();

    try {
      await this.supabase.from(this.tableName).insert({
        user_id: userId,
        requested_at: now.toISOString(),
      });
    } catch (error) {
      console.error("[RateLimiter] Failed to record request:", error);
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
      console.warn(
        "[RateLimiter] Could not get request count - user_id not found",
      );
      return 0;
    }

    const windowStart = new Date(Date.now() - this.windowMs);

    try {
      const { count, error } = await this.supabase
        .from(this.tableName)
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("requested_at", windowStart.toISOString());

      if (error) {
        console.error("[RateLimiter] Failed to count requests:", error);
        return 0;
      }

      return count || 0;
    } catch {
      return 0;
    }
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

    const count = await this.getRequestCount(apiKey);

    if (count >= this.maxRequests) {
      const oldestRequest = await this.getOldestRequest(apiKey);
      if (oldestRequest) {
        const now = Date.now();
        const age = now - oldestRequest.getTime();
        const waitTime = this.windowMs - age + 100; // +100ms buffer
        if (waitTime > 0) {
          console.log(
            `[RateLimiter] User rate limited. Waiting ${waitTime}ms before retry.`,
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
