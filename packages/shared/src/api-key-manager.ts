/**
 * API Key Management
 * Handles encryption/decryption of Torn API keys for secure storage
 * Uses the same AES-256-GCM encryption as the main encryption module
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TornApiClient } from "./torn.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Derive encryption key from master key
 */
function deriveKeyFromMaster(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey).digest();
}

/**
 * Encrypt an API key
 * Returns format: iv(32 hex) + tag(32 hex) + ciphertext(hex)
 */
export function encryptApiKey(apiKey: string, masterKey: string): string {
  const derivedKey = deriveKeyFromMaster(masterKey);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv + tag + ciphertext (all in hex)
  return iv.toString("hex") + authTag.toString("hex") + encrypted;
}

/**
 * Decrypt an API key
 * Expected format: iv(32 hex) + tag(32 hex) + ciphertext(hex)
 */
export function decryptApiKey(encrypted: string, masterKey: string): string {
  const derivedKey = deriveKeyFromMaster(masterKey);

  // Extract components
  const ivHex = encrypted.slice(0, IV_LENGTH * 2);
  const tagHex = encrypted.slice(
    IV_LENGTH * 2,
    IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2,
  );
  const ciphertextHex = encrypted.slice(IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, undefined, "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Hash API key for database tracking (non-reversible)
 * Used for rate limiting mapping
 */
export function hashApiKey(apiKey: string, pepper: string): string {
  return createHash("sha256")
    .update(apiKey + pepper)
    .digest("hex");
}

/**
 * Validate API key format
 */
export function isValidApiKey(key: string): boolean {
  return /^[a-zA-Z0-9]{16}$/.test(key);
}

/**
 * Validate encryption key is properly formatted
 */
export function isValidMasterKey(key: string): boolean {
  return Boolean(key && key.length >= 32); // Should be a strong key
}
/**
 * Ensure API key is mapped to user in database
 * Fetches user ID from /user/basic endpoint and creates mapping if missing
 * Call this once during worker initialization to ensure rate limiting works
 */
export async function ensureApiKeyMapped(
  apiKey: string,
  supabase: SupabaseClient,
  config: {
    tableName: string;
    hashPepper: string;
  },
): Promise<{ userId: number | null; error: string | null }> {
  const keyHash = hashApiKey(apiKey, config.hashPepper);

  try {
    // Check if mapping already exists
    const { data: existing, error: queryError } = await supabase
      .from(config.tableName)
      .select("user_id")
      .eq("api_key_hash", keyHash)
      .is("deleted_at", null)
      .single();

    if (!queryError && existing) {
      // Mapping already exists (silent)
      return { userId: (existing as any).user_id, error: null };
    }

    // Mapping missing - fetch user ID from Torn API
    // Create a temporary client without rate limiting for this initialization call
    const client = new TornApiClient();
    const data = await client.get("/user/basic", {
      apiKey,
    });

    const userId = data.profile.id;

    if (!userId) {
      const errorMsg = "No player_id in Torn API response";
      console.error(`[ApiKeyManager] ${errorMsg}`);
      return { userId: null, error: errorMsg };
    }

    // Create mapping
    const { error: insertError } = await supabase
      .from(config.tableName)
      .insert([
        {
          api_key_hash: keyHash,
          user_id: userId,
          created_at: new Date().toISOString(),
        },
      ]);

    if (insertError) {
      const errorMsg = `Failed to create API key mapping in database: ${insertError.message}`;
      console.error(`[ApiKeyManager] ${errorMsg}`);
      return { userId: null, error: errorMsg };
    }

    console.log(
      `[ApiKeyManager] ✓ Created API key mapping for player ${userId}`,
    );
    return { userId, error: null };
  } catch (error) {
    const errorMsg = `Unexpected error during API key mapping: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`[ApiKeyManager] ${errorMsg}`);
    return { userId: null, error: errorMsg };
  }
}
