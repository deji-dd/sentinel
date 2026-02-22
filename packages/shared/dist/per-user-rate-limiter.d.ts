/**
 * Per-User Rate Limiting for Torn API
 * Tracks requests per USER (not per key) to enforce Torn's actual limit:
 * Each user gets 100 requests/minute across ALL their API keys
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimitTracker } from "./torn.js";
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
export declare class PerUserRateLimiter implements RateLimitTracker {
    private supabase;
    private tableName;
    private apiKeyMappingTableName;
    private hashPepper;
    private maxRequests;
    private windowMs;
    private userIdCache;
    constructor(config: PerUserRateLimiterConfig);
    /**
     * Resolve user ID from API key by looking up in mapping table
     * Caches result for performance within a batch operation
     */
    private getUserIdFromApiKey;
    /**
     * Record a new request for a user
     * User ID is resolved from the API key
     */
    recordRequest(apiKey: string): Promise<void>;
    /**
     * Get request count for a user in the current window
     * User ID is resolved from the API key
     */
    getRequestCount(apiKey: string): Promise<number>;
    /**
     * Check if a user is rate limited
     */
    isRateLimited(apiKey: string): Promise<boolean>;
    /**
     * Get oldest request timestamp for a user in current window
     */
    getOldestRequest(apiKey: string): Promise<Date | null>;
    /**
     * Clean up old request records
     */
    cleanupOldRequests(): Promise<void>;
    /**
     * Wait if necessary to ensure we don't exceed per-user rate limit
     */
    waitIfNeeded(apiKey: string): Promise<void>;
    /**
     * Clear the user ID cache (call between batch operations)
     */
    clearCache(): void;
    /**
     * Get max requests per window
     */
    getMaxRequests(): number;
    /**
     * Set max requests per window (for per-user overrides)
     */
    setMaxRequests(max: number): void;
}
//# sourceMappingURL=per-user-rate-limiter.d.ts.map