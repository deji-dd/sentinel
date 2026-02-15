/**
 * Database-backed rate limiting for Torn API requests.
 * Tracks requests per API key to ensure no single key exceeds Torn's limits.
 * Coordinates across multiple instances (bot + worker) using shared database.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimitTracker } from "./torn.js";

const WINDOW_MS = 60000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 50; // Safety buffer: Torn allows 100 req/min, we use 50

export interface DatabaseRateLimiterConfig {
  supabase: SupabaseClient;
  tableName: string;
  hashPepper: string;
  maxRequestsPerWindow?: number;
  windowMs?: number;
}

/**
 * Database-backed rate limiter that implements the RateLimitTracker interface.
 * Use this to coordinate rate limiting across bot and worker instances.
 */
export class DatabaseRateLimiter implements RateLimitTracker {
  private supabase: SupabaseClient;
  private tableName: string;
  private hashPepper: string;
  private maxRequests: number;
  private windowMs: number;

  constructor(config: DatabaseRateLimiterConfig) {
    this.supabase = config.supabase;
    this.tableName = config.tableName;
    this.hashPepper = config.hashPepper;
    this.maxRequests = config.maxRequestsPerWindow ?? MAX_REQUESTS_PER_WINDOW;
    this.windowMs = config.windowMs ?? WINDOW_MS;

    if (!this.hashPepper) {
      throw new Error(
        "API_KEY_HASH_PEPPER is required for secure rate limiting",
      );
    }
  }

  /**
   * Hash API key for storage (don't store raw keys)
   */
  private hashApiKey(apiKey: string): string {
    return createHash("sha256")
      .update(apiKey + this.hashPepper)
      .digest("hex");
  }

  /**
   * Record a new request for an API key
   */
  async recordRequest(apiKey: string): Promise<void> {
    const keyHash = this.hashApiKey(apiKey);
    const now = new Date();

    try {
      await this.supabase.from(this.tableName).insert({
        api_key_hash: keyHash,
        requested_at: now.toISOString(),
      });
    } catch (error) {
      console.error("[RateLimiter] Failed to record per-user request:", error);
      throw error;
    }
  }

  /**
   * Get count of requests for an API key in the current window
   */
  async getRequestCount(apiKey: string): Promise<number> {
    const keyHash = this.hashApiKey(apiKey);
    const windowStart = new Date(Date.now() - this.windowMs);

    try {
      const { count, error } = await this.supabase
        .from(this.tableName)
        .select("*", { count: "exact", head: true })
        .eq("api_key_hash", keyHash)
        .gte("requested_at", windowStart.toISOString());

      if (error) {
        console.error("Failed to count per-user requests:", error);
        return 0;
      }

      return count || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Check if an API key is rate limited
   */
  async isRateLimited(apiKey: string): Promise<boolean> {
    const count = await this.getRequestCount(apiKey);
    return count >= this.maxRequests;
  }

  /**
   * Get oldest request timestamp for an API key in current window
   */
  async getOldestRequest(apiKey: string): Promise<Date | null> {
    const keyHash = this.hashApiKey(apiKey);
    const windowStart = new Date(Date.now() - this.windowMs);

    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select("requested_at")
        .eq("api_key_hash", keyHash)
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
   * Clean up old request records for all keys (older than window)
   */
  async cleanupOldRequests(): Promise<void> {
    const windowStart = new Date(Date.now() - this.windowMs);

    try {
      await this.supabase
        .from(this.tableName)
        .delete()
        .lt("requested_at", windowStart.toISOString());
    } catch (error) {
      console.error("Failed to cleanup per-user requests:", error);
    }
  }

  /**
   * Wait if necessary to ensure we don't exceed per-user rate limit.
   * This is called automatically by TornApiClient when rate limiting is enabled.
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
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          // Recursively check again in case multiple requests need to wait
          return this.waitIfNeeded(apiKey);
        }
      }
    }

    // Do NOT record the request here - let TornApiClient do it after successful API call
  }
}
