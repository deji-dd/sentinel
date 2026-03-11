import {
  type Client,
  EmbedBuilder,
  TextChannel,
  Message,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "./db-client.js";

/**
 * Manages the updating faction list in a designated channel.
 */
export async function updateFactionList(
  guildId: string,
  client: Client,
): Promise<void> {
  try {
    // 1. Fetch guild config for faction list channel and message IDs
    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!guildConfig || !guildConfig.faction_list_channel_id) {
      return;
    }

    const channelId = guildConfig.faction_list_channel_id;
    const channel = client.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      console.warn(`[Faction List] Channel ${channelId} not found in cache for guild ${guildId}`);
      return;
    }

    // 2. Fetch all enabled factions for this guild
    const factions = await db
      .selectFrom(TABLE_NAMES.FACTION_ROLES)
      .select(["faction_id", "faction_name"])
      .where("guild_id", "=", guildId)
      .where("enabled", "=", 1)
      .execute();

    // 3. Sort factions alphabetically by name
    const sortedFactions = [...factions].sort((a, b) => {
      const nameA = a.faction_name || `Faction ${a.faction_id}`;
      const nameB = b.faction_name || `Faction ${b.faction_id}`;
      return nameA.localeCompare(nameB);
    });

    // 4. Create embeds (10 factions per embed)
    const embeds: EmbedBuilder[] = [];
    const FACTIONS_PER_EMBED = 10;

    for (let i = 0; i < sortedFactions.length; i += FACTIONS_PER_EMBED) {
      const chunk = sortedFactions.slice(i, i + FACTIONS_PER_EMBED);
      const embed = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle(i === 0 ? "Mapped Factions" : "Mapped Factions (cont.)")
        .setTimestamp();

      const description = chunk
        .map((f) => {
          const name = f.faction_name || `Faction ${f.faction_id}`;
          return `• [${name}](https://www.torn.com/factions.php?step=profile&ID=${f.faction_id})`;
        })
        .join("\n");

      embed.setDescription(description);
      embeds.push(embed);
    }

    // Special case: no factions
    if (embeds.length === 0) {
      embeds.push(
        new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle("Mapped Factions")
          .setDescription("No factions currently mapped.")
          .setTimestamp(),
      );
    }

    // 5. Update messages
    const existingMessageIds: string[] = guildConfig.faction_list_message_ids
      ? JSON.parse(guildConfig.faction_list_message_ids)
      : [];
    const newMessageIds: string[] = [];

    // Map existing messages to their IDs or null
    for (let i = 0; i < embeds.length; i++) {
      const embed = embeds[i];
      const existingId = existingMessageIds[i];
      let msg: Message | null = null;

      if (existingId) {
        try {
          msg = await channel.messages.fetch(existingId);
          await msg.edit({ embeds: [embed] });
        } catch {
          // If we can't find the message, send a new one
          msg = await channel.send({ embeds: [embed] });
        }
      } else {
        msg = await channel.send({ embeds: [embed] });
      }

      if (msg) {
        newMessageIds.push(msg.id);
      }
    }

    // 6. Delete redundant messages
    if (existingMessageIds.length > embeds.length) {
      const toDelete = existingMessageIds.slice(embeds.length);
      for (const msgId of toDelete) {
        try {
          const msg = await channel.messages.fetch(msgId);
          await msg.delete();
        } catch {
          // Ignore delete errors (e.g. message already deleted)
        }
      }
    }

    // 7. Store new message IDs and update timestamp
    await db
      .updateTable(TABLE_NAMES.GUILD_CONFIG)
      .set({
        faction_list_message_ids: JSON.stringify(newMessageIds),
        faction_list_updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

  } catch (error) {
    console.error(`[Faction List] Error updating list for guild ${guildId}:`, error);
  }
}
