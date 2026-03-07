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
import { TABLE_NAMES } from "@sentinel/shared";
import { getDB } from "@sentinel/shared/db/sqlite.js";

if (!process.env.ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required");
}

if (!process.env.API_KEY_HASH_PEPPER) {
  throw new Error("API_KEY_HASH_PEPPER environment variable is required");
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const API_KEY_HASH_PEPPER = process.env.API_KEY_HASH_PEPPER;

interface GuildApiKeyRow {
  id: string;
  guild_id: string;
  user_id: number;
  api_key_encrypted: string;
  invalid_count: number | null;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("unique") || message.includes("constraint");
}

/**
 * Get guild's API keys (guild-isolated via RLS)
 * Returns decrypted keys for a specific guild
 */
export async function getGuildApiKeys(guildId: string): Promise<string[]> {
  const db = getDB();
  const data = db
    .prepare(
      `SELECT api_key_encrypted
       FROM "${TABLE_NAMES.GUILD_API_KEYS}"
       WHERE guild_id = ?
         AND deleted_at IS NULL
       ORDER BY is_primary DESC`,
    )
    .all(guildId) as Array<{ api_key_encrypted: string }>;

  const keys: string[] = [];
  for (const row of data) {
    try {
      const decrypted = decryptApiKey(row.api_key_encrypted, ENCRYPTION_KEY);
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
  guildId: string,
): Promise<string | null> {
  const db = getDB();
  const data = db
    .prepare(
      `SELECT api_key_encrypted
       FROM "${TABLE_NAMES.GUILD_API_KEYS}"
       WHERE guild_id = ?
         AND is_primary = 1
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(guildId) as { api_key_encrypted: string } | undefined;

  if (!data) {
    return null;
  }

  try {
    return decryptApiKey(data.api_key_encrypted, ENCRYPTION_KEY);
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
  guildId: string,
  apiKey: string,
  userId: number,
  providedBy: string,
  isPrimary: boolean = false,
): Promise<void> {
  const db = getDB();
  const encrypted = encryptApiKey(apiKey, ENCRYPTION_KEY);
  const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);

  // If setting as primary, unset other primaries first
  if (isPrimary) {
    db.prepare(
      `UPDATE "${TABLE_NAMES.GUILD_API_KEYS}" SET is_primary = 0 WHERE guild_id = ? AND is_primary = 1`,
    ).run(guildId);
  }

  // Store the encrypted key
  db.prepare(
    `INSERT INTO "${TABLE_NAMES.GUILD_API_KEYS}" (guild_id, user_id, api_key_encrypted, is_primary, provided_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(guildId, userId, encrypted, isPrimary ? 1 : 0, providedBy);

  // Register in mapping table for rate limiting
  try {
    db.prepare(
      `INSERT INTO "${TABLE_NAMES.API_KEY_USER_MAPPING}" (api_key_hash, user_id, source)
       VALUES (?, ?, ?)`,
    ).run(hash, userId, "guild");
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw new Error(
        `Failed to map API key for rate limiting: ${String(error)}`,
      );
    }
  }
}

/**
 * Delete a guild API key
 * @param supabase Supabase client (RLS enforces guild access)
 * @param guildId The guild ID
 * @param apiKey The raw API key to delete
 */
export async function deleteGuildApiKey(
  guildId: string,
  apiKey: string,
): Promise<void> {
  const db = getDB();
  // Find the key by decrypting and comparing
  const data = db
    .prepare(
      `SELECT id, guild_id, user_id, api_key_encrypted, invalid_count
       FROM "${TABLE_NAMES.GUILD_API_KEYS}"
       WHERE guild_id = ?
         AND deleted_at IS NULL`,
    )
    .all(guildId) as GuildApiKeyRow[];

  for (const row of data) {
    try {
      const decrypted = decryptApiKey(row.api_key_encrypted, ENCRYPTION_KEY);
      if (decrypted === apiKey) {
        // Soft delete the key
        const now = new Date().toISOString();
        db.prepare(
          `UPDATE "${TABLE_NAMES.GUILD_API_KEYS}" SET deleted_at = ? WHERE id = ?`,
        ).run(now, row.id);

        // Also soft-delete from mapping
        const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);
        db.prepare(
          `UPDATE "${TABLE_NAMES.API_KEY_USER_MAPPING}" SET deleted_at = ? WHERE api_key_hash = ?`,
        ).run(now, hash);

        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      // Continue searching for the key
    }
  }

  throw new Error("Guild API key not found");
}

/**
 * Mark guild API key as invalid (increment counter, soft-delete after threshold)
 * Called when Torn API returns "Incorrect Key" error to prevent IP blocking
 * @param supabase Supabase client
 * @param apiKey The raw API key that failed
 * @param threshold Number of failures before soft-deleting (default: 3)
 */
export async function markGuildApiKeyInvalid(
  apiKey: string,
  threshold: number = 3,
): Promise<void> {
  const db = getDB();
  const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);

  // Find the key by hash in mapping table
  const mapping = db
    .prepare(
      `SELECT user_id
       FROM "${TABLE_NAMES.API_KEY_USER_MAPPING}"
       WHERE api_key_hash = ?
         AND source = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(hash, "guild") as { user_id: number } | undefined;

  if (!mapping) {
    console.warn(`Could not find guild API key mapping for invalid key`);
    return;
  }

  const userId = mapping.user_id;

  // Find the key record
  const keys = db
    .prepare(
      `SELECT id, guild_id, user_id, api_key_encrypted, invalid_count
       FROM "${TABLE_NAMES.GUILD_API_KEYS}"
       WHERE user_id = ?
         AND deleted_at IS NULL`,
    )
    .all(userId) as GuildApiKeyRow[];

  if (!keys || keys.length === 0) {
    console.warn("Could not find guild API key records");
    return;
  }

  // Find matching key by decrypting
  for (const row of keys) {
    try {
      const decrypted = decryptApiKey(row.api_key_encrypted, ENCRYPTION_KEY);
      if (decrypted === apiKey) {
        const currentCount = row.invalid_count || 0;
        const newCount = currentCount + 1;
        const guildId = row.guild_id;
        const now = new Date().toISOString();

        // Soft-delete if threshold reached
        if (newCount >= threshold) {
          console.warn(
            `Guild API key (guild: ${guildId}) reached ${threshold} invalid attempts, soft-deleting`,
          );

          // Also soft-delete from mapping
          db.prepare(
            `UPDATE "${TABLE_NAMES.API_KEY_USER_MAPPING}" SET deleted_at = ? WHERE api_key_hash = ?`,
          ).run(now, hash);

          db.prepare(
            `UPDATE "${TABLE_NAMES.GUILD_API_KEYS}"
             SET invalid_count = ?, last_invalid_at = ?, deleted_at = ?
             WHERE id = ?`,
          ).run(newCount, now, now, row.id);
        } else {
          db.prepare(
            `UPDATE "${TABLE_NAMES.GUILD_API_KEYS}"
             SET invalid_count = ?, last_invalid_at = ?
             WHERE id = ?`,
          ).run(newCount, now, row.id);
        }

        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      // Continue searching for the key
    }
  }

  console.warn("Guild API key not found for invalid marking");
}

/**
 * Get all guilds that have API keys (useful for system operations like TT syncing)
 * Can list guilds with TT module enabled and their available keys
 *
 * @param supabase Service role client (admin access)
 */
export async function getGuildsWithApiKeys(): Promise<
  Array<{ guildId: string; keyCount: number }>
> {
  const db = getDB();
  const data = db
    .prepare(
      `SELECT guild_id FROM "${TABLE_NAMES.GUILD_API_KEYS}" WHERE deleted_at IS NULL`,
    )
    .all() as Array<{ guild_id: string }>;

  // Count keys per guild
  const guildCounts = new Map<string, number>();
  for (const row of data) {
    const guildId = row.guild_id;
    guildCounts.set(guildId, (guildCounts.get(guildId) || 0) + 1);
  }

  return Array.from(guildCounts.entries()).map(([guildId, keyCount]) => ({
    guildId,
    keyCount,
  }));
}
