/**
 * Parses dynamic territory events (War Starts, Racket Spawns) and routes them
 * to the correct Discord channels.
 */

import {
  getRacketBaseName,
  getSystemKeyPool,
  GuildConfigs,
  Logger,
  toBotPacket,
  validateAndFetchFactionDetails,
} from "@sentinel/shared";
import { Client, EmbedBuilder, TextChannel } from "discord.js";

export async function handleTerritoryEvent(
  client: Client,
  packet: toBotPacket,
  logger: Logger,
) {
  try {
    const embed = new EmbedBuilder()
      .setFooter({ text: "Sentinel" })
      .setTimestamp();

    let tt: string;
    const involvedFactions: number[] = [];

    if (
      packet.action === "peace_treaty" ||
      packet.action === "assault_succeed" ||
      packet.action === "assault_fail" ||
      packet.action === "assault_start"
    ) {
      const aFacId = packet.data.assaulting_faction;
      const dFacId = packet.data.defending_faction;
      const vFacId = packet.data.victor_faction;
      const [aFac, dFac, vFac] = await Promise.all([
        getFactionName(aFacId),
        getFactionName(dFacId),
        getFactionName(vFacId),
      ]);
      tt = packet.data.tt;

      if (aFacId) involvedFactions.push(aFacId);
      if (dFacId) involvedFactions.push(dFacId);
      if (vFacId) involvedFactions.push(vFacId);

      switch (packet.action) {
        case "peace_treaty": {
          embed
            .setTitle(`Peace Treaty • ${tt}`)
            .setColor(0x38bdf8) // Sky Blue
            .setFields(
              {
                name: "Territory",
                value: `[${tt}](https://www.torn.com/city.php#terrName=${tt})`,
                inline: false,
              },
              {
                name: "Assaulting Faction",
                value: `[${aFac}](https://www.torn.com/factions.php?step=profile&ID=${aFacId})`,
                inline: false,
              },
              {
                name: "Defending Faction",
                value: `[${dFac}](https://www.torn.com/factions.php?step=profile&ID=${dFacId})`,
                inline: false,
              },
            );

          break;
        }

        case "assault_succeed": {
          embed
            .setTitle(`Assault Succeeded • ${tt}`)
            .setColor(0x22c55e) // Green
            .setFields(
              {
                name: "Territory",
                value: `[${tt}](https://www.torn.com/city.php#terrName=${tt})`,
                inline: false,
              },
              {
                name: "Assaulting Faction",
                value: `[${aFac}](https://www.torn.com/factions.php?step=profile&ID=${aFacId})`,
                inline: false,
              },
              {
                name: "Defending Faction",
                value: `[${dFac}](https://www.torn.com/factions.php?step=profile&ID=${dFacId})`,
                inline: false,
              },
              {
                name: "Victor Faction",
                value: `[${vFac}](https://www.torn.com/factions.php?step=profile&ID=${vFacId})`,
                inline: false,
              },
            );

          break;
        }

        case "assault_fail": {
          embed
            .setTitle(`Assault Failed • ${tt}`)
            .setColor(0xef4444) // Red
            .setFields(
              {
                name: "Territory",
                value: `[${tt}](https://www.torn.com/city.php#terrName=${tt})`,
                inline: false,
              },
              {
                name: "Assaulting Faction",
                value: `[${aFac}](https://www.torn.com/factions.php?step=profile&ID=${aFacId})`,
                inline: false,
              },
              {
                name: "Defending Faction",
                value: `[${dFac}](https://www.torn.com/factions.php?step=profile&ID=${dFacId})`,
                inline: false,
              },
            );

          break;
        }

        case "assault_start": {
          embed
            .setTitle(`Assault Started • ${tt}`)
            .setColor(0xf59e0b) // Amber
            .setFields(
              {
                name: "Territory",
                value: `[${tt}](https://www.torn.com/city.php#terrName=${tt})`,
                inline: false,
              },
              {
                name: "Assaulting Faction",
                value: `[${aFac}](https://www.torn.com/factions.php?step=profile&ID=${aFacId})`,
                inline: false,
              },
              {
                name: "Defending Faction",
                value: `[${dFac}](https://www.torn.com/factions.php?step=profile&ID=${dFacId})`,
                inline: false,
              },
            );
          break;
        }
      }
    } else if (
      packet.action === "tt_claim" ||
      packet.action === "tt_drop" ||
      packet.action === "racket_spawn" ||
      packet.action === "racket_despawn" ||
      packet.action === "racket_level_up" ||
      packet.action === "racket_level_down"
    ) {
      const id = packet.data.id;
      const facId = packet.data.faction_id;
      const fac = await getFactionName(facId);
      const racket = packet.data.racket;
      let racketBaseName: string;
      tt = packet.data.id;

      if (facId) involvedFactions.push(facId);

      if (racket) racketBaseName = getRacketBaseName(racket.name);

      switch (packet.action) {
        case "tt_claim": {
          embed
            .setTitle(`Territory Claim • ${id}`)
            .setColor(0x3b82f6) // Blue
            .setFields(
              {
                name: "Territory",
                value: `[${id}](https://www.torn.com/city.php#terrName=${id})`,
                inline: false,
              },
              {
                name: "Faction",
                value: `[${fac}](https://www.torn.com/factions.php?step=profile&ID=${facId})`,
              },
            );

          break;
        }

        case "tt_drop": {
          embed
            .setTitle(`Territory Drop • ${id}`)
            .setColor(0x64748b) // Slate
            .addFields(
              {
                name: "Territory",
                value: `[${id}](https://www.torn.com/city.php#terrName=${id})`,
                inline: false,
              },
              {
                name: "Faction",
                value: `[${fac}](https://www.torn.com/factions.php?step=profile&ID=${facId})`,
              },
            );

          break;
        }

        case "racket_spawn": {
          embed
            .setTitle(`Racket Spawn • ${id}`)
            .setColor(0xa855f7) // Purple
            .addFields(
              {
                name: "Territory",
                value: `[${id}](https://www.torn.com/city.php#terrName=${id})`,
                inline: false,
              },
              {
                name: "Faction",
                value: `[${fac}](https://www.torn.com/factions.php?step=profile&ID=${facId})`,
              },
              { name: "Racket", value: `${racketBaseName}` },
              { name: "Level", value: `${racket.level}` },
              { name: "Reward", value: `${racket.description}` },
            );
          break;
        }

        case "racket_level_up": {
          embed
            .setTitle(`Racket Level Up • ${id}`)
            .setColor(0x22c55e) // Green
            .addFields(
              {
                name: "Territory",
                value: `[${id}](https://www.torn.com/city.php#terrName=${id})`,
                inline: false,
              },
              {
                name: "Faction",
                value: `[${fac}](https://www.torn.com/factions.php?step=profile&ID=${facId})`,
              },
              { name: "Racket", value: `${racketBaseName}` },
              { name: "Level", value: `${racket.level}` },
              { name: "Reward", value: `${racket.description}` },
            );
          break;
        }

        case "racket_level_down": {
          embed
            .setTitle(`Racket Level Down • ${id}`)
            .setColor(0xf59e0b) // Amber
            .addFields(
              {
                name: "Territory",
                value: `[${id}](https://www.torn.com/city.php#terrName=${id})`,
                inline: false,
              },
              {
                name: "Faction",
                value: `[${fac}](https://www.torn.com/factions.php?step=profile&ID=${facId})`,
              },
              { name: "Racket", value: `${racketBaseName}` },
              { name: "Level", value: `${racket.level}` },
              { name: "Reward", value: `${racket.description}` },
            );
          break;
        }

        case "racket_despawn": {
          embed
            .setTitle(`Racket Despawn • ${id}`)
            .setColor(0xef4444) // Red
            .addFields(
              {
                name: "Territory",
                value: `[${id}](https://www.torn.com/city.php#terrName=${id})`,
                inline: false,
              },
              {
                name: "Faction",
                value: `[${fac}](https://www.torn.com/factions.php?step=profile&ID=${facId})`,
              },
              { name: "Racket", value: `${racketBaseName}` },
              { name: "Level", value: `${racket.level}` },
              { name: "Reward", value: `${racket.description}` },
            );
          break;
        }
      }
    }

    // Fetch all guilds that have the territories module enabled
    const configs = GuildConfigs.findAll().filter((c) =>
      c.enabled_modules?.includes("territories"),
    );

    for (const config of configs) {
      const sentChannelIds = new Set<string>();

      // Send to FULL feed if configured
      if (config.tt_full_channel_id) {
        const channel = (await client.channels
          .fetch(config.tt_full_channel_id)
          .catch(() => null)) as TextChannel;
        if (channel) {
          await channel.send({ embeds: [embed] }).catch(() => null);
          sentChannelIds.add(config.tt_full_channel_id);
        }
      }

      // Send to FILTERED feed if configured AND matches criteria
      if (
        config.tt_filtered_channel_id &&
        !sentChannelIds.has(config.tt_filtered_channel_id)
      ) {
        const isTerritoryMatch = config.tt_territory_ids?.includes(tt);
        const isFactionMatch = config.tt_faction_ids?.some((fid) =>
          involvedFactions.includes(fid),
        );

        if (isTerritoryMatch || isFactionMatch) {
          const channel = (await client.channels
            .fetch(config.tt_filtered_channel_id)
            .catch(() => null)) as TextChannel;
          if (channel) {
            await channel.send({ embeds: [embed] }).catch(() => null);
          }
        }
      }
    }
  } catch (err) {
    logger.error("Failed to handle territory event", err);
  }
}

async function getFactionName(
  factionId: number | null,
): Promise<string | undefined> {
  if (!factionId) return;

  const keys = getSystemKeyPool();
  const key =
    keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : "";

  const factionDetails = await validateAndFetchFactionDetails(factionId, key);
  return factionDetails.data.name;
}
