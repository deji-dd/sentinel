import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "./db-client.js";

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
export async function upsertVerifiedUser(
  input: UpsertVerifiedUserInput,
): Promise<void> {
  const now = input.now ?? new Date().toISOString();

  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom(TABLE_NAMES.VERIFIED_USERS)
      .where((eb) =>
        eb.or([
          eb("discord_id", "=", input.discordId),
          eb("torn_id", "=", input.tornId),
        ]),
      )
      .execute();

    await trx
      .insertInto(TABLE_NAMES.VERIFIED_USERS)
      .values({
        discord_id: input.discordId,
        torn_id: input.tornId,
        torn_name: input.tornName,
        faction_id: input.factionId,
        faction_tag: input.factionTag,
        created_at: now,
        updated_at: now,
      })
      .execute();
  });
}
