/**
 * System API Key Management for Worker
 * Handles encryption, storage, and retrieval of system-level API keys
 * Used for worker infrastructure syncing (personal data, items, gyms, TT, etc.)
 *
 * System keys are separate from guild keys because:
 * - Workers are not accessible by regular users
 * - System keys can be configured for infrastructure syncing
 * - Can fallback to env var (TORN_API_KEY) for backward compatibility
 */

import { encryptApiKey, decryptApiKey, hashApiKey } from "@sentinel/shared";
import { supabase } from "./supabase.js";
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
 * Get system API key for worker operations
 * Try env var first (backward compatible), then database
 *
 * @param keyType - 'personal' (env var) or 'system' (stored in DB)
 */
export async function getSystemApiKey(
  keyType: "personal" | "system" = "personal",
): Promise<string> {
  // First, try environment variable (personal/fallback key)
  if (keyType === "personal") {
    const envKey = process.env.TORN_API_KEY;
    if (envKey) {
      return envKey;
    }
  }

  // Try to get from database (system key or primary from DB)
  const { data, error } = await supabase
    .from(TABLE_NAMES.SYSTEM_API_KEYS)
    .select("api_key_encrypted")
    .eq("is_primary", true)
    .eq("key_type", keyType === "personal" ? "personal" : "system")
    .is("deleted_at", null)
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(
      `No ${keyType} API key found. Set TORN_API_KEY env var or configure in database.`,
    );
  }

  try {
    return decryptApiKey((data as any).api_key_encrypted, ENCRYPTION_KEY);
  } catch (err) {
    throw new Error(`Failed to decrypt system API key: ${err}`);
  }
}

/**
 * Store a system API key in database
 * @param apiKey The raw API key
 * @param userId The user who owns this key
 * @param keyType 'personal' or 'system'
 * @param isPrimary Whether this is the default key to use
 */
export async function storeSystemApiKey(
  apiKey: string,
  userId: string,
  keyType: "personal" | "system" = "system",
  isPrimary: boolean = false,
): Promise<void> {
  const encrypted = encryptApiKey(apiKey, ENCRYPTION_KEY);
  const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);

  // Store the encrypted key
  const { error: insertError } = await supabase
    .from(TABLE_NAMES.SYSTEM_API_KEYS)
    .insert({
      user_id: userId,
      api_key_encrypted: encrypted,
      is_primary: isPrimary,
      key_type: keyType,
    });

  if (insertError) {
    throw new Error(`Failed to store system API key: ${insertError.message}`);
  }

  // Register in mapping table for rate limiting
  const { error: mapError } = await supabase
    .from(TABLE_NAMES.API_KEY_USER_MAPPING)
    .insert({
      api_key_hash: hash,
      user_id: userId,
      source: "system",
    });

  if (mapError && !mapError.message.includes("duplicate")) {
    throw new Error(
      `Failed to map API key for rate limiting: ${mapError.message}`,
    );
  }
}

/**
 * Get all system API keys for a user (for batch operations)
 * Useful for TT syncing or infrastructure tasks that can use multiple keys
 */
export async function getSystemApiKeys(
  userId: string,
  keyType?: "personal" | "system",
): Promise<string[]> {
  let query = supabase
    .from(TABLE_NAMES.SYSTEM_API_KEYS)
    .select("api_key_encrypted")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (keyType) {
    query = query.eq("key_type", keyType);
  }

  const { data, error } = await query.order("is_primary", { ascending: false });

  if (error) {
    console.error(`Failed to retrieve system API keys: ${error.message}`);
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
      console.error("Failed to decrypt system API key:", err);
    }
  }

  return keys;
}

/**
 * Get primary system API key
 */
export async function getPrimarySystemApiKey(
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.SYSTEM_API_KEYS)
    .select("api_key_encrypted")
    .eq("user_id", userId)
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
    console.error("Failed to decrypt primary system API key:", err);
    return null;
  }
}

/**
 * Mark a system API key as deleted (soft delete)
 */
export async function deleteSystemApiKey(
  userId: string,
  apiKey: string,
): Promise<void> {
  // Find the key by decrypting and comparing
  const { data, error } = await supabase
    .from(TABLE_NAMES.SYSTEM_API_KEYS)
    .select("id, api_key_encrypted")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Failed to find system API key: ${error.message}`);
  }

  for (const row of data || []) {
    try {
      const decrypted = decryptApiKey(
        (row as any).api_key_encrypted,
        ENCRYPTION_KEY,
      );
      if (decrypted === apiKey) {
        const { error: deleteError } = await supabase
          .from(TABLE_NAMES.SYSTEM_API_KEYS)
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

  throw new Error("System API key not found");
}

/**
 * Mark system API key as invalid (increment counter, soft-delete after threshold)
 * Called when Torn API returns "Incorrect Key" error to prevent IP blocking
 * @param apiKey The raw API key that failed
 * @param threshold Number of failures before soft-deleting (default: 3)
 */
export async function markSystemApiKeyInvalid(
  apiKey: string,
  threshold: number = 3,
): Promise<void> {
  const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);

  // Find the key by hash in mapping table
  const { data: mapping, error: mapError } = await supabase
    .from(TABLE_NAMES.API_KEY_USER_MAPPING)
    .select("user_id")
    .eq("api_key_hash", hash)
    .eq("source", "system")
    .is("deleted_at", null)
    .single();

  if (mapError || !mapping) {
    console.warn(`Could not find system API key mapping for invalid key`);
    return;
  }

  const userId = (mapping as any).user_id;

  // Find the key record
  const { data: keys, error: keysError } = await supabase
    .from(TABLE_NAMES.SYSTEM_API_KEYS)
    .select("id, api_key_encrypted, invalid_count")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (keysError || !keys || keys.length === 0) {
    console.warn("Could not find system API key records");
    return;
  }

  // Find matching key by decrypting
  for (const row of keys) {
    try {
      const decrypted = decryptApiKey(
        (row as any).api_key_encrypted,
        ENCRYPTION_KEY,
      );
      if (decrypted === apiKey) {
        const currentCount = (row as any).invalid_count || 0;
        const newCount = currentCount + 1;

        // Update invalid count and timestamp
        const updates: any = {
          invalid_count: newCount,
          last_invalid_at: new Date().toISOString(),
        };

        // Soft-delete if threshold reached
        if (newCount >= threshold) {
          updates.deleted_at = new Date().toISOString();
          console.warn(
            `System API key reached ${threshold} invalid attempts, soft-deleting`,
          );

          // Also soft-delete from mapping
          await supabase
            .from(TABLE_NAMES.API_KEY_USER_MAPPING)
            .update({ deleted_at: new Date().toISOString() })
            .eq("api_key_hash", hash);
        }

        const { error: updateError } = await supabase
          .from(TABLE_NAMES.SYSTEM_API_KEYS)
          .update(updates)
          .eq("id", (row as any).id);

        if (updateError) {
          console.error(
            "Failed to mark system API key as invalid:",
            updateError,
          );
        }

        return;
      }
    } catch (err) {
      // Continue searching for the key
    }
  }

  console.warn("System API key not found for invalid marking");
}
