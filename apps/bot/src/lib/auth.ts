import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";

interface UserData {
  user_id: string;
  player_id: number;
  name: string | null;
  discord_id: string | null;
}

/**
 * Check if a Discord user is authorized (has entry in sentinel_user_data).
 * @returns user_id if authorized, null if not found
 */
export async function getAuthorizedUser(
  supabase: SupabaseClient,
  discordId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.USER_DATA)
    .select("user_id")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (error) {
    console.error(
      `[Auth] Error checking authorization for Discord ID ${discordId}:`,
      error,
    );
    return null;
  }

  return data?.user_id || null;
}

/**
 * Check if a Discord user already has an account.
 * @returns true if user exists, false otherwise
 */
export async function userExists(
  supabase: SupabaseClient,
  discordId: string,
): Promise<boolean> {
  const userId = await getAuthorizedUser(supabase, discordId);
  return userId !== null;
}

/**
 * Get full user data by Discord ID.
 */
export async function getUserData(
  supabase: SupabaseClient,
  discordId: string,
): Promise<UserData | null> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.USER_DATA)
    .select("user_id, player_id, name, discord_id")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (error) {
    console.error(
      `[Auth] Error fetching user data for Discord ID ${discordId}:`,
      error,
    );
    return null;
  }

  return data;
}
