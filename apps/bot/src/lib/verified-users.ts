import { TABLE_NAMES } from "@sentinel/shared";
import { getDB } from "@sentinel/shared/db/sqlite.js";

type UpsertVerifiedUserInput = {
  discordId: string;
  tornId: number;
  tornName: string;
  factionId: number | null;
  factionTag: string | null;
  now?: string;
};

/**
 * Persist a verified user without relying on SQLite UNIQUE/PK constraints.
 * This keeps a single row for either discord_id or torn_id.
 */
export function upsertVerifiedUser(input: UpsertVerifiedUserInput): void {
  const db = getDB();
  const now = input.now ?? new Date().toISOString();

  const replaceUser = db.transaction(() => {
    db.prepare(
      `DELETE FROM "${TABLE_NAMES.VERIFIED_USERS}" WHERE discord_id = ? OR torn_id = ?`,
    ).run(input.discordId, input.tornId);

    db.prepare(
      `INSERT INTO "${TABLE_NAMES.VERIFIED_USERS}" (
        discord_id,
        torn_id,
        torn_name,
        faction_id,
        faction_tag,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.discordId,
      input.tornId,
      input.tornName,
      input.factionId,
      input.factionTag,
      now,
      now,
    );
  });

  replaceUser();
}
