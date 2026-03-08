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
import { TABLE_NAMES } from "@sentinel/shared";

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
  return db.transaction().execute(async (trx) => {
    const messageRecord = await trx
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .select(["message_id"])
      .where("id", "=", recordId)
      .executeTakeFirst();

    if (!messageRecord) {
      throw new Error(
        `Reaction role message record not found for id=${recordId}`,
      );
    }

    const oldMessageId = messageRecord.message_id;

    const updateMappingsResult = await trx
      .updateTable(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .set({ message_id: newMessageId })
      .where("message_id", "=", oldMessageId)
      .executeTakeFirst();

    const updateMessageResult = await trx
      .updateTable(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .set({ message_id: newMessageId, updated_at: new Date().toISOString() })
      .where("id", "=", recordId)
      .executeTakeFirst();

    return {
      updated_message_rows: Number(updateMessageResult.numUpdatedRows),
      updated_mapping_rows: Number(updateMappingsResult.numUpdatedRows),
    };
  });
}
