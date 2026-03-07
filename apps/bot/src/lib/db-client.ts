/**
 * Database client for Discord Bot
 * 
 * This module exports the Kysely database instance for type-safe queries.
 * 
 * Legacy RPC functions (e.g., sentinel_finalize_reaction_role_message) have been
 * converted to standalone helper functions.
 */

import { getKysely, getDB } from "@sentinel/shared/db/sqlite.js";
import type { DB } from "@sentinel/shared";

const isDev = process.env.NODE_ENV === "development";
console.log(
  `[DB] Connected to ${isDev ? "local" : "production"} SQLite database`,
);

// Export Kysely instance (type-safe query builder)
export const db = getKysely();

// Export raw better-sqlite3 instance for transactions and edge cases
export const rawDb = getDB();

/**
 * RPC-style helper: Finalize reaction role message
 * Updates message_id in both the message record and its mappings
 */
export async function finalizeReactionRoleMessage(
  recordId: number,
  newMessageId: string,
): Promise<{ updated_message_rows: number; updated_mapping_rows: number }> {
  const transaction = rawDb.transaction(() => {
    const messageRecord = rawDb
      .prepare(
        "SELECT message_id FROM sentinel_reaction_role_messages WHERE id = ?",
      )
      .get(recordId) as { message_id: string } | undefined;

    if (!messageRecord) {
      throw new Error(
        `Reaction role message record not found for id=${recordId}`,
      );
    }

    const oldMessageId = messageRecord.message_id;

    const updateMappingsStmt = rawDb
      .prepare(
        "UPDATE sentinel_reaction_role_mappings SET message_id = ? WHERE message_id = ?",
      )
      .run(newMessageId, oldMessageId);

    const updateMessageStmt = rawDb
      .prepare(
        "UPDATE sentinel_reaction_role_messages SET message_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(newMessageId, new Date().toISOString(), recordId);

    return {
      updated_message_rows: updateMessageStmt.changes,
      updated_mapping_rows: updateMappingsStmt.changes,
    };
  });

  return transaction();
}
