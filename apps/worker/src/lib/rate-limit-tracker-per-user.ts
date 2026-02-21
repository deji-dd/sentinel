/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Per-user rate limit tracking using database.
 * Tracks API requests per API key to ensure no single key exceeds limits.
 * Persists across restarts and coordinates across multiple instances.
 */

import { createHash } from "crypto";
import { supabase } from "./supabase.js";
import { TABLE_NAMES } from "@sentinel/shared";

const TRACKER_TABLE = TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER;
const WINDOW_MS = 60000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 50; // Per-user limit: 50 req/min (Torn allows 100 per key, use 50 for safety)

/**
 * Hash API key for storage (don't store raw keys)
 * Uses a secret pepper for additional security
 */
function hashApiKey(apiKey: string): string {
  const pepper = process.env.API_KEY_HASH_PEPPER;
  if (!pepper) {
    throw new Error(
      "API_KEY_HASH_PEPPER environment variable is required for secure rate limiting",
    );
  }
  return createHash("sha256")
    .update(apiKey + pepper)
    .digest("hex");
}

/**
 * Record a new request for an API key
 */
export async function recordRequestPerUser(apiKey: string): Promise<void> {
  const keyHash = hashApiKey(apiKey);
  const now = new Date();

  try {
    await supabase.from(TRACKER_TABLE).insert({
      api_key_hash: keyHash,
      requested_at: now.toISOString(),
    });
  } catch (error) {
    console.error("Failed to record per-user request:", error);
  }
}

/**
 * Get count of requests for an API key in the current window
 */
export async function getRequestCountPerUser(apiKey: string): Promise<number> {
  const keyHash = hashApiKey(apiKey);
  const windowStart = new Date(Date.now() - WINDOW_MS);

  try {
    const { count, error } = await supabase
      .from(TRACKER_TABLE)
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
export async function isRateLimitedPerUser(apiKey: string): Promise<boolean> {
  const count = await getRequestCountPerUser(apiKey);
  return count >= MAX_REQUESTS_PER_WINDOW;
}

/**
 * Get oldest request timestamp for an API key in current window
 */
export async function getOldestRequestPerUser(
  apiKey: string,
): Promise<Date | null> {
  const keyHash = hashApiKey(apiKey);
  const windowStart = new Date(Date.now() - WINDOW_MS);

  try {
    const { data, error } = await supabase
      .from(TRACKER_TABLE)
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
export async function cleanupOldRequestsPerUser(): Promise<void> {
  const windowStart = new Date(Date.now() - WINDOW_MS);

  try {
    await supabase
      .from(TRACKER_TABLE)
      .delete()
      .lt("requested_at", windowStart.toISOString());
  } catch (error) {
    console.error("Failed to cleanup per-user requests:", error);
  }
}

/**
 * Wait if necessary to ensure we don't exceed per-user rate limit.
 */
export async function waitIfNeededPerUser(apiKey: string): Promise<void> {
  // Periodic cleanup
  cleanupOldRequestsPerUser().catch(() => {});

  const count = await getRequestCountPerUser(apiKey);

  if (count >= MAX_REQUESTS_PER_WINDOW) {
    const oldestRequest = await getOldestRequestPerUser(apiKey);
    if (oldestRequest) {
      const now = Date.now();
      const age = now - oldestRequest.getTime();
      const waitTime = WINDOW_MS - age + 100; // +100ms buffer
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        // Recursively check again in case multiple requests need to wait
        return waitIfNeededPerUser(apiKey);
      }
    }
  }

  // Record this request
  await recordRequestPerUser(apiKey);
}
