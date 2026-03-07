/**
 * System API Key Management for Worker
 * Handles encryption, storage, and retrieval of system-level API keys
 * Used for worker infrastructure syncing (personal data, items, gyms, TT, etc.)
 *
 * System keys are separate from guild keys because:
 * - Workers are not accessible by regular users
 * - System keys can be configured for infrastructure syncing
 * - Uses DB-backed keys only (no env fallback)
 */

import { encryptApiKey, decryptApiKey, hashApiKey } from "@sentinel/shared";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { randomUUID } from "crypto";

if (!process.env.ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required");
}

if (!process.env.API_KEY_HASH_PEPPER) {
  throw new Error("API_KEY_HASH_PEPPER environment variable is required");
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const API_KEY_HASH_PEPPER = process.env.API_KEY_HASH_PEPPER;

interface SystemApiKeyEncryptedRow {
  id: string;
  api_key_encrypted: string;
  key_type?: "personal" | "system";
  invalid_count?: number | null;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("unique") || message.includes("constraint");
}

/**
 * Get system API key for worker operations
 * Reads from database (personal or system key types)
 *
 * @param keyType - 'personal' (env var) or 'system' (stored in DB)
 */
export async function getSystemApiKey(
  keyType: "personal" | "system" = "personal",
): Promise<string> {
  const db = getKysely();
  const row = await db
    .selectFrom(TABLE_NAMES.SYSTEM_API_KEYS)
    .select("api_key_encrypted")
    .where("is_primary", "=", 1)
    .where("key_type", "=", keyType)
    .where("deleted_at", "is", null)
    .limit(1)
    .executeTakeFirst();

  if (!row) {
    throw new Error(`No ${keyType} API key found in database.`);
  }

  try {
    return decryptApiKey(row.api_key_encrypted, ENCRYPTION_KEY);
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
  userId: number,
  keyType: "personal" | "system" = "system",
  isPrimary: boolean = false,
): Promise<void> {
  const db = getKysely();
  const encrypted = encryptApiKey(apiKey, ENCRYPTION_KEY);
  const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);

  // Store the encrypted key
  // Check if this key already exists (deduplication)
  const existing = await db
    .selectFrom(TABLE_NAMES.SYSTEM_API_KEYS)
    .select("id")
    .where("api_key_hash", "=", hash)
    .where("deleted_at", "is", null)
    .limit(1)
    .executeTakeFirst();

  if (existing) {
    // Key already exists - update it
    await db
      .updateTable(TABLE_NAMES.SYSTEM_API_KEYS)
      .set({
        user_id: userId,
        api_key_encrypted: encrypted,
        is_primary: isPrimary ? 1 : 0,
        key_type: keyType,
      })
      .where("id", "=", existing.id)
      .execute();

    console.log(
      `[SystemKeys] Updated existing ${keyType} key for user ${userId}`,
    );
  } else {
    // New key - insert it
    await db
      .insertInto(TABLE_NAMES.SYSTEM_API_KEYS)
      .values({
        id: randomUUID(),
        user_id: userId,
        api_key_encrypted: encrypted,
        api_key_hash: hash,
        is_primary: isPrimary ? 1 : 0,
        key_type: keyType,
      })
      .execute();

    console.log(`[SystemKeys] Added new ${keyType} key for user ${userId}`);
  }

  // Register in mapping table for rate limiting
  try {
    await db
      .insertInto(TABLE_NAMES.API_KEY_USER_MAPPING)
      .values({
        api_key_hash: hash,
        user_id: userId,
        source: "system",
        deleted_at: null,
      })
      .execute();
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw new Error(
        `Failed to map API key for rate limiting: ${String(error)}`,
      );
    }
  }
}

/**
 * Get all system API keys for a user (for batch operations)
 * Useful for TT syncing or infrastructure tasks that can use multiple keys
 */
export async function getSystemApiKeys(
  userId: number,
  keyType?: "personal" | "system",
): Promise<string[]> {
  const db = getKysely();
  let query = db
    .selectFrom(TABLE_NAMES.SYSTEM_API_KEYS)
    .select("api_key_encrypted")
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .orderBy("is_primary", "desc");

  if (keyType) {
    query = query.where("key_type", "=", keyType);
  }

  const rows = await query.execute();

  const keys: string[] = [];
  for (const row of rows) {
    try {
      const decrypted = decryptApiKey(row.api_key_encrypted, ENCRYPTION_KEY);
      keys.push(decrypted);
    } catch (err) {
      console.error("Failed to decrypt system API key:", err);
    }
  }

  return keys;
}

/**
 * Get all system API keys across all users (for public worker pool).
 */
export async function getAllSystemApiKeys(
  keyType: "personal" | "system" | "all" = "system",
): Promise<string[]> {
  const db = getKysely();
  let query = db
    .selectFrom(TABLE_NAMES.SYSTEM_API_KEYS)
    .select(["api_key_encrypted", "key_type"])
    .where("deleted_at", "is", null)
    .orderBy("is_primary", "desc")
    .orderBy("created_at", "asc");

  if (keyType !== "all") {
    query = query.where("key_type", "=", keyType);
  }

  const data = await query.execute();

  const systemKeys: string[] = [];
  const personalKeys: string[] = [];
  for (const row of data) {
    try {
      const decrypted = decryptApiKey(row.api_key_encrypted, ENCRYPTION_KEY);

      // For pooled usage, bias toward system keys by returning them first.
      if (keyType === "all") {
        const rowKeyType = row.key_type;
        if (rowKeyType === "personal") {
          personalKeys.push(decrypted);
        } else {
          systemKeys.push(decrypted);
        }
      } else {
        systemKeys.push(decrypted);
      }
    } catch (err) {
      console.error("Failed to decrypt system API key:", err);
    }
  }

  if (keyType === "all") {
    return [...systemKeys, ...personalKeys];
  }

  return systemKeys;
}

/**
 * Get primary system API key
 */
export async function getPrimarySystemApiKey(
  userId: number,
): Promise<string | null> {
  const db = getKysely();
  const data = await db
    .selectFrom(TABLE_NAMES.SYSTEM_API_KEYS)
    .select("api_key_encrypted")
    .where("user_id", "=", userId)
    .where("is_primary", "=", 1)
    .where("deleted_at", "is", null)
    .limit(1)
    .executeTakeFirst();

  if (!data) {
    return null;
  }

  try {
    return decryptApiKey(data.api_key_encrypted, ENCRYPTION_KEY);
  } catch (err) {
    console.error("Failed to decrypt primary system API key:", err);
    return null;
  }
}

/**
 * Mark a system API key as deleted (soft delete)
 */
export async function deleteSystemApiKey(
  userId: number,
  apiKey: string,
): Promise<void> {
  const db = getKysely();
  // Find the key by decrypting and comparing
  const data = (await db
    .selectFrom(TABLE_NAMES.SYSTEM_API_KEYS)
    .select(["id", "api_key_encrypted"])
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .execute()) as SystemApiKeyEncryptedRow[];

  for (const row of data) {
    try {
      const decrypted = decryptApiKey(row.api_key_encrypted, ENCRYPTION_KEY);
      if (decrypted === apiKey) {
        const now = new Date().toISOString();
        await db
          .updateTable(TABLE_NAMES.SYSTEM_API_KEYS)
          .set({ deleted_at: now })
          .where("id", "=", row.id)
          .execute();

        // Also soft-delete from mapping
        const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);
        await db
          .updateTable(TABLE_NAMES.API_KEY_USER_MAPPING)
          .set({ deleted_at: now })
          .where("api_key_hash", "=", hash)
          .execute();

        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const db = getKysely();
  const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);

  // Find the key by hash in mapping table
  const mapping = await db
    .selectFrom(TABLE_NAMES.API_KEY_USER_MAPPING)
    .select("user_id")
    .where("api_key_hash", "=", hash)
    .where("source", "=", "system")
    .where("deleted_at", "is", null)
    .limit(1)
    .executeTakeFirst();

  if (!mapping) {
    console.warn(`Could not find system API key mapping for invalid key`);
    return;
  }

  const userId = mapping.user_id;

  // Find the key record
  const keys = (await db
    .selectFrom(TABLE_NAMES.SYSTEM_API_KEYS)
    .select(["id", "api_key_encrypted", "invalid_count"])
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .execute()) as SystemApiKeyEncryptedRow[];

  if (!keys || keys.length === 0) {
    console.warn("Could not find system API key records");
    return;
  }

  // Find matching key by decrypting
  for (const row of keys) {
    try {
      const decrypted = decryptApiKey(row.api_key_encrypted, ENCRYPTION_KEY);
      if (decrypted === apiKey) {
        const currentCount = row.invalid_count || 0;
        const newCount = currentCount + 1;
        const now = new Date().toISOString();

        // Soft-delete if threshold reached
        if (newCount >= threshold) {
          console.warn(
            `System API key reached ${threshold} invalid attempts, soft-deleting`,
          );

          // Also soft-delete from mapping
          await db
            .updateTable(TABLE_NAMES.API_KEY_USER_MAPPING)
            .set({ deleted_at: now })
            .where("api_key_hash", "=", hash)
            .execute();

          await db
            .updateTable(TABLE_NAMES.SYSTEM_API_KEYS)
            .set({
              invalid_count: newCount,
              last_invalid_at: now,
              deleted_at: now,
            })
            .where("id", "=", row.id)
            .execute();
        } else {
          await db
            .updateTable(TABLE_NAMES.SYSTEM_API_KEYS)
            .set({
              invalid_count: newCount,
              last_invalid_at: now,
            })
            .where("id", "=", row.id)
            .execute();
        }

        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      // Continue searching for the key
    }
  }

  console.warn("System API key not found for invalid marking");
}
