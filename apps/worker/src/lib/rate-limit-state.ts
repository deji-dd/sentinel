/**
 * Shared rate limit state tracker using database.
 * Allows multiple worker processes to coordinate and respect global rate limits.
 */

import { supabase } from "./supabase.js";
import { TABLE_NAMES } from "./constants.js";

const RATE_LIMIT_COOLDOWN_MS = 90000; // 90 seconds cooldown when rate limited
const STATE_KEY = "torn_api_rate_limit";

interface RateLimitState {
  key: string;
  is_limited: boolean;
  limited_until: string | null;
  last_error_at: string | null;
  updated_at: string;
}

/**
 * Check if we're currently in a rate-limited state
 */
export async function isRateLimited(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from(TABLE_NAMES.WORKER_LOGS)
      .select("*")
      .eq("worker_id", STATE_KEY)
      .single();

    if (error || !data) {
      return false; // No state = not limited
    }

    const state = data as any;
    if (!state.is_limited || !state.limited_until) {
      return false;
    }

    const limitedUntil = new Date(state.limited_until).getTime();
    const now = Date.now();

    if (now < limitedUntil) {
      return true; // Still in cooldown period
    }

    // Cooldown expired, clear the limit
    await clearRateLimit();
    return false;
  } catch {
    return false; // On error, assume not limited
  }
}

/**
 * Record that we've been rate limited
 */
export async function recordRateLimit(): Promise<void> {
  const now = new Date();
  const limitedUntil = new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS);

  try {
    await supabase.from(TABLE_NAMES.WORKER_LOGS).upsert(
      {
        worker_id: STATE_KEY,
        is_limited: true,
        limited_until: limitedUntil.toISOString(),
        last_error_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: "worker_id" },
    );
  } catch (error) {
    console.error("Failed to record rate limit state:", error);
  }
}

/**
 * Clear rate limit state
 */
export async function clearRateLimit(): Promise<void> {
  try {
    await supabase.from(TABLE_NAMES.WORKER_LOGS).upsert(
      {
        worker_id: STATE_KEY,
        is_limited: false,
        limited_until: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "worker_id" },
    );
  } catch (error) {
    console.error("Failed to clear rate limit state:", error);
  }
}

/**
 * Wait if we're currently rate limited
 */
export async function waitIfRateLimited(): Promise<void> {
  const limited = await isRateLimited();
  if (!limited) {
    return;
  }

  // Get exact wait time
  try {
    const { data } = await supabase
      .from(TABLE_NAMES.WORKER_LOGS)
      .select("*")
      .eq("worker_id", STATE_KEY)
      .single();

    if (data && (data as any).limited_until) {
      const limitedUntil = new Date((data as any).limited_until).getTime();
      const now = Date.now();
      const waitTime = Math.max(0, limitedUntil - now);

      if (waitTime > 0) {
        console.log(
          `[rate-limit] Waiting ${Math.ceil(waitTime / 1000)}s due to global rate limit`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  } catch {
    // Wait default cooldown on error
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_COOLDOWN_MS));
  }
}
