/**
 * Guild API Key Management for Bot
 * Handles encryption, storage, and retrieval of guild-specific API keys
 * Used for guild operations while maintaining strict guild isolation
 *
 * Guild keys are separate from system keys because:
 * - Each guild manages its own keys independently
 * - RLS ensures guild members can only see/manage their guild's keys
 * - Keys cannot be shared between guilds
 * - Verification module and other guild features use these keys exclusively
 */

import { encryptApiKey, decryptApiKey, hashApiKey } from "@sentinel/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const API_KEY_HASH_PEPPER = process.env.API_KEY_HASH_PEPPER;

if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required");
}

if (!API_KEY_HASH_PEPPER) {
  throw new Error("API_KEY_HASH_PEPPER environment variable is required");
}

/**
 * Get guild's API keys (guild-isolated via RLS)
 * Returns decrypted keys for a specific guild
 */
export async function getGuildApiKeys(
  supabase: SupabaseClient,
  guildId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.GUILD_API_KEYS)
    .select("api_key_encrypted")
    .eq("guild_id", guildId)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false });

  if (error) {
    console.error(`Failed to retrieve guild API keys: ${error.message}`);
    return [];
  }

  const keys: string[] = [];
  for (const row of data || []) {
    try {
      const decrypted = decryptApiKey(
        (row as any).api_key_encrypted,
        ENCRYPTION_KEY,
      );
      keys.push(decrypted);
    } catch (err) {
      console.error("Failed to decrypt guild API key:", err);
    }
  }

  return keys;
}

/**
 * Get primary API key for a guild
 * Returns null if no primary key is set
 */
export async function getPrimaryGuildApiKey(
  supabase: SupabaseClient,
  guildId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.GUILD_API_KEYS)
    .select("api_key_encrypted")
    .eq("guild_id", guildId)
    .eq("is_primary", true)
    .is("deleted_at", null)
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  try {
    return decryptApiKey((data as any).api_key_encrypted, ENCRYPTION_KEY);
  } catch (err) {
    console.error("Failed to decrypt primary guild API key:", err);
    return null;
  }
}

/**
 * Store an API key for a guild
 * @param supabase Supabase client (will use RLS to ensure guild access)
 * @param guildId The guild this key belongs to
 * @param apiKey The raw API key
 * @param userId The auth user who owns this key (extracted from auth.users)
 * @param providedBy The Discord user ID who provided this key
 * @param isPrimary Whether this is the default key for guild operations
 */
export async function storeGuildApiKey(
  supabase: SupabaseClient,
  guildId: string,
  apiKey: string,
  userId: string,
  providedBy: string,
  isPrimary: boolean = false,
): Promise<void> {
  const encrypted = encryptApiKey(apiKey, ENCRYPTION_KEY);
  const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);

  // If setting as primary, unset other primaries first
  if (isPrimary) {
    await supabase
      .from(TABLE_NAMES.GUILD_API_KEYS)
      .update({ is_primary: false })
      .eq("guild_id", guildId)
      .eq("is_primary", true);
  }

  // Store the encrypted key
  const { error: insertError } = await supabase
    .from(TABLE_NAMES.GUILD_API_KEYS)
    .insert({
      guild_id: guildId,
      user_id: userId,
      api_key_encrypted: encrypted,
      is_primary: isPrimary,
      provided_by: providedBy,
    });

  if (insertError) {
    throw new Error(`Failed to store guild API key: ${insertError.message}`);
  }

  // Register in mapping table for rate limiting
  const { error: mapError } = await supabase
    .from(TABLE_NAMES.API_KEY_USER_MAPPING)
    .insert({
      api_key_hash: hash,
      user_id: userId,
      source: "guild",
    });

  if (mapError && !mapError.message.includes("duplicate")) {
    throw new Error(`Failed to map API key for rate limiting: ${mapError.message}`);
  }
}

/**
 * Delete a guild API key
 * @param supabase Supabase client (RLS enforces guild access)
 * @param guildId The guild ID
 * @param apiKey The raw API key to delete
 */
export async function deleteGuildApiKey(
  supabase: SupabaseClient,
  guildId: string,
  apiKey: string,
): Promise<void> {
  // Find the key by decrypting and comparing
  const { data, error } = await supabase
    .from(TABLE_NAMES.GUILD_API_KEYS)
    .select("id, api_key_encrypted, user_id")
    .eq("guild_id", guildId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Failed to find guild API key: ${error.message}`);
  }

  for (const row of data || []) {
    try {
      const decrypted = decryptApiKey(
        (row as any).api_key_encrypted,
        ENCRYPTION_KEY,
      );
      if (decrypted === apiKey) {
        // Soft delete the key
        const { error: deleteError } = await supabase
          .from(TABLE_NAMES.GUILD_API_KEYS)
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", (row as any).id);

        if (deleteError) {
          throw deleteError;
        }

        // Also soft-delete from mapping
        const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);
        await supabase
          .from(TABLE_NAMES.API_KEY_USER_MAPPING)
          .update({ deleted_at: new Date().toISOString() })
          .eq("api_key_hash", hash);

        return;
      }
    } catch (err) {
      // Continue searching for the key
    }
  }

  throw new Error("Guild API key not found");
}

/**
 * Get all guilds that have API keys (useful for system operations like TT syncing)
 * Can list guilds with TT module enabled and their available keys
 *
 * @param supabase Service role client (admin access)
 */
export async function getGuildsWithApiKeys(
  supabase: SupabaseClient,
): Promise<Array<{ guildId: string; keyCount: number }>> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.GUILD_API_KEYS)
    .select("guild_id")
    .is("deleted_at", null);

  if (error) {
    console.error("Failed to get guilds with API keys:", error);
    return [];
  }

  // Count keys per guild
  const guildCounts = new Map<string, number>();
  for (const row of data || []) {
    const guildId = (row as any).guild_id;
    guildCounts.set(guildId, (guildCounts.get(guildId) || 0) + 1);
  }

  return Array.from(guildCounts.entries()).map(([guildId, keyCount]) => ({
    guildId,
    keyCount,
  }));
}
