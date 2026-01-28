/**
 * Database-backed rate limiting for Torn API requests.
 * Tracks requests per API key to ensure no single key exceeds Torn's limits.
 * Coordinates across multiple instances (bot + worker) using shared database.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimitTracker } from "./torn.js";
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
export declare class DatabaseRateLimiter implements RateLimitTracker {
    private supabase;
    private tableName;
    private hashPepper;
    private maxRequests;
    private windowMs;
    constructor(config: DatabaseRateLimiterConfig);
    /**
     * Hash API key for storage (don't store raw keys)
     */
    private hashApiKey;
    /**
     * Record a new request for an API key
     */
    recordRequest(apiKey: string): Promise<void>;
    /**
     * Get count of requests for an API key in the current window
     */
    getRequestCount(apiKey: string): Promise<number>;
    /**
     * Check if an API key is rate limited
     */
    isRateLimited(apiKey: string): Promise<boolean>;
    /**
     * Get oldest request timestamp for an API key in current window
     */
    getOldestRequest(apiKey: string): Promise<Date | null>;
    /**
     * Clean up old request records for all keys (older than window)
     */
    cleanupOldRequests(): Promise<void>;
    /**
     * Wait if necessary to ensure we don't exceed per-user rate limit.
     * This is called automatically by TornApiClient when rate limiting is enabled.
     */
    waitIfNeeded(apiKey: string): Promise<void>;
}
//# sourceMappingURL=rate-limiter.d.ts.map