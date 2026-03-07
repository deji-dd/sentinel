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
import { getDB } from "@sentinel/shared/db/sqlite.js";

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
  const db = getDB();
  const row = db
    .prepare(
      `SELECT api_key_encrypted
       FROM "${TABLE_NAMES.SYSTEM_API_KEYS}"
       WHERE is_primary = 1
         AND key_type = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(keyType) as { api_key_encrypted: string } | undefined;

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
  const db = getDB();
  const encrypted = encryptApiKey(apiKey, ENCRYPTION_KEY);
  const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);

  // Store the encrypted key
  // Check if this key already exists (deduplication)
  const existing = db
    .prepare(
      `SELECT id
       FROM "${TABLE_NAMES.SYSTEM_API_KEYS}"
       WHERE api_key_hash = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(hash) as { id: string } | undefined;

  if (existing) {
    // Key already exists - update it
    db.prepare(
      `UPDATE "${TABLE_NAMES.SYSTEM_API_KEYS}"
       SET user_id = ?, api_key_encrypted = ?, is_primary = ?, key_type = ?
       WHERE id = ?`,
    ).run(userId, encrypted, isPrimary ? 1 : 0, keyType, existing.id);

    console.log(
      `[SystemKeys] Updated existing ${keyType} key for user ${userId}`,
    );
  } else {
    // New key - insert it
    db.prepare(
      `INSERT INTO "${TABLE_NAMES.SYSTEM_API_KEYS}"
       (user_id, api_key_encrypted, api_key_hash, is_primary, key_type)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(userId, encrypted, hash, isPrimary ? 1 : 0, keyType);

    console.log(`[SystemKeys] Added new ${keyType} key for user ${userId}`);
  }

  // Register in mapping table for rate limiting
  try {
    db.prepare(
      `INSERT INTO "${TABLE_NAMES.API_KEY_USER_MAPPING}"
       (api_key_hash, user_id, source)
       VALUES (?, ?, ?)`,
    ).run(hash, userId, "system");
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
  const db = getDB();
  const rows = keyType
    ? (db
        .prepare(
          `SELECT api_key_encrypted
           FROM "${TABLE_NAMES.SYSTEM_API_KEYS}"
           WHERE user_id = ?
             AND key_type = ?
             AND deleted_at IS NULL
           ORDER BY is_primary DESC`,
        )
        .all(userId, keyType) as Array<{ api_key_encrypted: string }>)
    : (db
        .prepare(
          `SELECT api_key_encrypted
           FROM "${TABLE_NAMES.SYSTEM_API_KEYS}"
           WHERE user_id = ?
             AND deleted_at IS NULL
           ORDER BY is_primary DESC`,
        )
        .all(userId) as Array<{ api_key_encrypted: string }>);

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
  const db = getDB();
  const data =
    keyType === "all"
      ? (db
          .prepare(
            `SELECT api_key_encrypted, key_type
           FROM "${TABLE_NAMES.SYSTEM_API_KEYS}"
           WHERE deleted_at IS NULL
           ORDER BY is_primary DESC, created_at ASC`,
          )
          .all() as Array<{
          api_key_encrypted: string;
          key_type: string | null;
        }>)
      : (db
          .prepare(
            `SELECT api_key_encrypted, key_type
           FROM "${TABLE_NAMES.SYSTEM_API_KEYS}"
           WHERE deleted_at IS NULL
             AND key_type = ?
           ORDER BY is_primary DESC, created_at ASC`,
          )
          .all(keyType) as Array<{
          api_key_encrypted: string;
          key_type: string | null;
        }>);

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
  const db = getDB();
  const data = db
    .prepare(
      `SELECT api_key_encrypted
       FROM "${TABLE_NAMES.SYSTEM_API_KEYS}"
       WHERE user_id = ?
         AND is_primary = 1
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(userId) as { api_key_encrypted: string } | undefined;

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
  const db = getDB();
  // Find the key by decrypting and comparing
  const data = db
    .prepare(
      `SELECT id, api_key_encrypted
       FROM "${TABLE_NAMES.SYSTEM_API_KEYS}"
       WHERE user_id = ?
         AND deleted_at IS NULL`,
    )
    .all(userId) as SystemApiKeyEncryptedRow[];

  for (const row of data) {
    try {
      const decrypted = decryptApiKey(row.api_key_encrypted, ENCRYPTION_KEY);
      if (decrypted === apiKey) {
        const now = new Date().toISOString();
        db.prepare(
          `UPDATE "${TABLE_NAMES.SYSTEM_API_KEYS}" SET deleted_at = ? WHERE id = ?`,
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
    .get(hash, "system") as { user_id: number } | undefined;

  if (!mapping) {
    console.warn(`Could not find system API key mapping for invalid key`);
    return;
  }

  const userId = mapping.user_id;

  // Find the key record
  const keys = db
    .prepare(
      `SELECT id, api_key_encrypted, invalid_count
       FROM "${TABLE_NAMES.SYSTEM_API_KEYS}"
       WHERE user_id = ?
         AND deleted_at IS NULL`,
    )
    .all(userId) as SystemApiKeyEncryptedRow[];

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
          db.prepare(
            `UPDATE "${TABLE_NAMES.API_KEY_USER_MAPPING}" SET deleted_at = ? WHERE api_key_hash = ?`,
          ).run(now, hash);

          db.prepare(
            `UPDATE "${TABLE_NAMES.SYSTEM_API_KEYS}"
             SET invalid_count = ?, last_invalid_at = ?, deleted_at = ?
             WHERE id = ?`,
          ).run(newCount, now, now, row.id);
        } else {
          db.prepare(
            `UPDATE "${TABLE_NAMES.SYSTEM_API_KEYS}"
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

  console.warn("System API key not found for invalid marking");
}
