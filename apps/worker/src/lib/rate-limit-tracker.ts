/**
 * Database-backed request tracker for rate limiting.
 * Persists request history across app restarts.
 */

import { supabase } from "./supabase.js";

const TRACKER_TABLE = "sentinel_rate_limit_requests";
const WINDOW_MS = 60000; // 1 minute window

/**
 * Record a new API request
 */
export async function recordRequest(): Promise<void> {
  const now = new Date();

  try {
    await supabase.from(TRACKER_TABLE).insert({
      requested_at: now.toISOString(),
    });
  } catch (error) {
    console.error("Failed to record request:", error);
  }
}

/**
 * Get count of requests in the current window
 */
export async function getRequestCount(): Promise<number> {
  const windowStart = new Date(Date.now() - WINDOW_MS);

  try {
    const { count, error } = await supabase
      .from(TRACKER_TABLE)
      .select("*", { count: "exact", head: true })
      .gte("requested_at", windowStart.toISOString());

    if (error) {
      console.error("Failed to count requests:", error);
      return 0;
    }

    return count || 0;
  } catch {
    return 0;
  }
}

/**
 * Clean up old request records (older than window)
 */
export async function cleanupOldRequests(): Promise<void> {
  const cutoff = new Date(Date.now() - WINDOW_MS * 2); // Keep 2x window for safety

  try {
    await supabase
      .from(TRACKER_TABLE)
      .delete()
      .lt("requested_at", cutoff.toISOString());
  } catch (error) {
    console.error("Failed to cleanup old requests:", error);
  }
}

/**
 * Get oldest request timestamp in current window
 */
export async function getOldestRequestInWindow(): Promise<Date | null> {
  const windowStart = new Date(Date.now() - WINDOW_MS);

  try {
    const { data, error } = await supabase
      .from(TRACKER_TABLE)
      .select("requested_at")
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
