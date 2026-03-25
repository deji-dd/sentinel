import { type EmbedBuilder } from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../../lib/db-client.js";
import { fetchTornProfileData } from "../../../lib/torn-api.js";
import { upsertEmbedField } from "./assist-support.js";

const ASSIST_STRIKE_BLACKLIST_THRESHOLD = 5;

export async function enrichAssistEmbed(
  embed: EmbedBuilder,
  targetTornId: number,
  apiKey: string,
): Promise<void> {
  try {
    const profileData = await fetchTornProfileData(targetTornId, apiKey);

    if (profileData?.profile) {
      const targetDisplay = `[${profileData.profile.name} [${targetTornId}]](https://www.torn.com/profiles.php?XID=${targetTornId})`;
      upsertEmbedField(embed, "Target", targetDisplay, true);

      if (profileData.faction?.name) {
        upsertEmbedField(embed, "Faction", profileData.faction.name, true);
      }
    } else {
      upsertEmbedField(embed, "Target", `[${targetTornId}]`, true);
    }
  } catch (error) {
    console.error(
      `[ASSIST] Failed to enrich embed for ${targetTornId}:`,
      error,
    );
    upsertEmbedField(embed, "Target", `[${targetTornId}]`, true);
  }
}

export async function incrementAssistStrikeByUuid(
  uuid: string,
  reason: string,
): Promise<void> {
  const token = await db
    .selectFrom(TABLE_NAMES.ASSIST_TOKENS)
    .select(["id", "strike_count", "is_active"])
    .where("token_uuid", "=", uuid)
    .executeTakeFirst();

  if (!token || !token.is_active) {
    return;
  }

  const nextStrike = (token.strike_count || 0) + 1;
  const shouldBlacklist = nextStrike >= ASSIST_STRIKE_BLACKLIST_THRESHOLD;

  await db
    .updateTable(TABLE_NAMES.ASSIST_TOKENS)
    .set({
      strike_count: nextStrike,
      is_active: shouldBlacklist ? 0 : 1,
      blacklisted_at: shouldBlacklist ? new Date().toISOString() : null,
      blacklisted_reason: shouldBlacklist ? reason : null,
      updated_at: new Date().toISOString(),
    })
    .where("id", "=", token.id)
    .execute();
}
