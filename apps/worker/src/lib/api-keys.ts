/**
 * API Key Management for Worker
 * Handles encryption, storage, and retrieval of user API keys
 */

import { encryptApiKey, decryptApiKey } from "@sentinel/shared";
import { supabase } from "./supabase.js";
import { TABLE_NAMES } from "@sentinel/shared";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required");
}

/**
 * Store an encrypted API key for a user
 */
export async function storeUserApiKey(
  userId: string,
  apiKey: string,
  isPrimary: boolean = false,
): Promise<void> {
  const encrypted = encryptApiKey(apiKey, ENCRYPTION_KEY);

  const { error } = await supabase.from(TABLE_NAMES.USER_KEYS).insert({
    user_id: userId,
    api_key_encrypted: encrypted,
    is_primary: isPrimary,
  });

  if (error) {
    throw new Error(`Failed to store API key: ${error.message}`);
  }
}

/**
 * Get all API keys for a user
 */
export async function getUserApiKeys(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.USER_KEYS)
    .select("api_key_encrypted")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false });

  if (error) {
    console.error(`Failed to retrieve user API keys: ${error.message}`);
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
      console.error("Failed to decrypt API key:", err);
    }
  }

  return keys;
}

/**
 * Get primary API key for a user
 */
export async function getPrimaryUserApiKey(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.USER_KEYS)
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
    console.error("Failed to decrypt primary API key:", err);
    return null;
  }
}

/**
 * Update API key last_used timestamp
 */
export async function updateApiKeyLastUsed(apiKey: string): Promise<void> {
  // This would typically be called after a successful API call
  // For now, it's a placeholder for batch operation tracking
  // In production, you might track which key was used for each request
}

/**
 * Mark an API key as deleted (soft delete)
 */
export async function deleteUserApiKey(
  userId: string,
  apiKey: string,
): Promise<void> {
  // Find the key by decrypting and comparing
  const { data, error } = await supabase
    .from(TABLE_NAMES.USER_KEYS)
    .select("id, api_key_encrypted")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Failed to find API key: ${error.message}`);
  }

  for (const row of data || []) {
    try {
      const decrypted = decryptApiKey(
        (row as any).api_key_encrypted,
        ENCRYPTION_KEY,
      );
      if (decrypted === apiKey) {
        const { error: updateError } = await supabase
          .from(TABLE_NAMES.USER_KEYS)
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", (row as any).id);

        if (updateError) {
          throw updateError;
        }
        return;
      }
    } catch (err) {
      // Continue searching for the key
    }
  }

  throw new Error("API key not found");
}
