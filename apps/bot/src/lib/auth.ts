import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Personalized bot mode: Get the single configured Sentinel user ID
 * All Discord users who invoke commands will use this user's data
 */
export function getPersonalUserId(): string {
  const userId = process.env.SENTINEL_USER_ID;
  if (!userId) {
    throw new Error(
      "SENTINEL_USER_ID environment variable is required for personalized bot mode",
    );
  }
  return userId;
}

export function getAuthorizedDiscordUserId(): string {
  const discordUserId = process.env.SENTINEL_DISCORD_USER_ID;
  if (!discordUserId) {
    throw new Error(
      "SENTINEL_DISCORD_USER_ID environment variable is required for bot access control",
    );
  }
  return discordUserId;
}

/**
 * Check if a user exists in the database (legacy - deprecated)
 * DEPRECATED: Kept for compatibility during migration
 */
export async function getAuthorizedUser(
  supabase: SupabaseClient,
  discordId: string,
): Promise<string | null> {
  // In personalized mode, just return the fixed user ID
  // Discord authorization is handled at the bot level, not per-user
  try {
    return getPersonalUserId();
  } catch {
    return null;
  }
}
