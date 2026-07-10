import { Client, EmbedBuilder, TextChannel } from "discord.js";
import {
  Logger,
  GuildConfigs,
  getSystemKeyPool,
  validateAndFetchFactionDetails,
  IpcServer,
} from "@sentinel/shared";
import { logGuildError } from "./guild-logger.js";

const logger = new Logger("IPC_Listener");

export function setupIpcServer(client: Client): void {
  const socketPath = "/tmp/sentinel-bot.sock";
  const ipcServer = new IpcServer(socketPath, async (packet) => {
    const { action, payload } = packet;

    try {
      switch (action) {
        case "VERIFICATION_READY": {
          logger.info(
            `Applying Verification UI state for Discord ID: ${payload.discordId}`,
          );

          try {
            const guild = await client.guilds.fetch(payload.guildId);
            const member = await guild.members.fetch(payload.discordId);

            if (payload.status === "success") {
              // 1. Update Nickname
              if (payload.nickname) {
                await member
                  .setNickname(payload.nickname)
                  .catch((err) =>
                    logger.debug(
                      `Failed to set nickname for ${payload.discordId}: ${err}`,
                    ),
                  );
              }

              // 2. Add Valid Roles
              for (const roleId of payload.rolesToAdd || []) {
                await member.roles
                  .add(roleId)
                  .catch((err) =>
                    logger.debug(
                      `Failed to add role ${roleId} to ${payload.discordId}: ${err}`,
                    ),
                  );
              }

              // 3. Remove Invalid Roles
              for (const roleId of payload.rolesToRemove || []) {
                await member.roles
                  .remove(roleId)
                  .catch((err) =>
                    logger.debug(
                      `Failed to remove role ${roleId} from ${payload.discordId}: ${err}`,
                    ),
                  );
              }
            }

            // 4. Optionally send a DM to the user with the result if provided
            if (payload.dmEmbed) {
              await member
                .send({ embeds: [payload.dmEmbed] })
                .catch(() => null);
            }
          } catch (error) {
            logger.error(
              `Failed to apply verification state for ${payload.discordId}`,
              error,
            );
            await logGuildError(
              payload.guildId,
              client,
              "Verification UI Application Failed",
              error instanceof Error ? error.message : String(error),
              `Failed to apply roles/nickname to <@${payload.discordId}>. Check bot hierarchy and permissions.`,
            );
          }
          break;
        }

        case "SEND_DM": {
          const user = await client.users.fetch(payload.discordId);
          if (user) await user.send({ embeds: [payload.embed] });
          break;
        }

        case "BAZAAR_DROP_DETECTED": {
          const channel = (await client.channels
            .fetch(payload.channelId)
            .catch(() => null)) as TextChannel;
          if (!channel) return;

          const embed = new EmbedBuilder()
            .setTitle("🚨 Bazaar Drop Detected!")
            .setColor(0xef4444) // Bright Red
            .setDescription(
              `**[${payload.playerName} [${payload.playerId}]](https://www.torn.com/profiles.php?XID=${payload.playerId})** just dropped their bazaar value!`,
            )
            .addFields(
              {
                name: "Previous Value",
                value: `$${payload.pastVal.toLocaleString()}`,
                inline: true,
              },
              {
                name: "Current Value",
                value: `$${payload.currentVal.toLocaleString()}`,
                inline: true,
              },
              {
                name: "Drop Amount",
                value: `**-$${payload.dropAmount.toLocaleString()}**`,
                inline: true,
              },
            )
            .setTimestamp();

          // Ping the role if the guild configured one
          const content = payload.pingRoleId
            ? `<@&${payload.pingRoleId}>`
            : undefined;
          await channel.send({ content, embeds: [embed] });
          break;
        }

        case "BAZAAR_DASHBOARD_UPDATE": {
          if (!payload.messageId || !payload.channelId) return;

          const channel = (await client.channels
            .fetch(payload.channelId)
            .catch(() => null)) as TextChannel;
          if (!channel) return;

          const message = await channel.messages
            .fetch(payload.messageId)
            .catch(() => null);
          if (!message) return;

          // Format the live leaderboard
          const sortedTargets = payload.targets.sort(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (a: any, b: any) => b.value - a.value,
          );
          let description = "Live tracking of targeted bazaars.\n\n";

          for (const t of sortedTargets) {
            const statusEmoji = t.isOnline ? "🟢" : "⚪";
            description += `${statusEmoji} **[${t.name} [${t.playerId}]]** — \`$${t.value.toLocaleString()}\`\n`;
            description += `└ *Status: ${t.status}*\n\n`;
          }

          const embed = new EmbedBuilder()
            .setTitle("📊 Live Bazaar Tracker")
            .setColor(0x3b82f6) // Blue
            .setDescription(description || "No active targets.")
            .setFooter({ text: "Last updated" })
            .setTimestamp();

          await message.edit({ embeds: [embed] });
          break;
        }

        case "TERRITORY_EVENT": {
          // Offload to a dedicated function to keep this switch block clean
          await handleTerritoryEvent(client, payload);
          break;
        }

        case "SYSTEM_ERROR": {
          // Allows background workers to report failures directly to Discord Admins
          await logGuildError(
            payload.guildId,
            client,
            `⚙️ System Error: ${payload.title}`,
            payload.description,
          );
          break;
        }

        default:
          logger.warn(`Unknown IPC action received: ${action}`);
      }
    } catch (err) {
      logger.error(`Failed to handle IPC action '${action}':`, err);
    }
  });

  ipcServer.start();
}

/**
 * Parses dynamic territory events (War Starts, Racket Spawns) and routes them
 * to the correct Discord channels.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleTerritoryEvent(client: Client, payload: any) {
  const eventType = payload.eventType;
  const eventData = payload.data;

  logger.info(`Received Territory Event: ${eventType}`);

  if (!eventData) return;

  const embed = new EmbedBuilder().setTimestamp();

  let territoryId = "";
  const involvedFactions: string[] = [];

  // Helper to fetch faction names
  async function getFactionName(
    factionId: number | string | undefined | null,
  ): Promise<string> {
    if (
      !factionId ||
      factionId === "0" ||
      String(factionId) === "undefined" ||
      String(factionId) === "null"
    )
      return "Unknown Faction";
    const numId = Number(factionId);
    if (isNaN(numId)) return "Unknown Faction";

    const keys = getSystemKeyPool();
    const key =
      keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : "";

    const factionDetails = await validateAndFetchFactionDetails(numId, key);
    return factionDetails?.data?.name || `Faction ${numId}`;
  }

  // Pre-resolve all potential faction IDs
  const fAssaultingId =
    eventData.data?.assaulting_faction || eventData.war?.assaulting_faction;
  const fDefendingId =
    eventData.data?.defending_faction || eventData.war?.defending_faction;
  const fVictorId = eventData.war?.victor_faction;
  const fGeneralId = eventData.factionId;

  const [nameAssaulting, nameDefending, nameVictor, nameGeneral] =
    await Promise.all([
      getFactionName(fAssaultingId),
      getFactionName(fDefendingId),
      getFactionName(fVictorId),
      getFactionName(fGeneralId),
    ]);

  switch (eventType) {
    case "war_started":
      territoryId = eventData.territory;
      involvedFactions.push(String(fAssaultingId), String(fDefendingId));
      embed
        .setTitle(`War Started: ${territoryId}`)
        .setColor(0xf59e0b) // Orange
        .setDescription(
          `**[${nameAssaulting}](https://www.torn.com/factions.php?step=profile&ID=${fAssaultingId})** has assaulted **[${nameDefending}](https://www.torn.com/factions.php?step=profile&ID=${fDefendingId})** for control of **[${territoryId}](https://www.torn.com/city.php#terrName=${territoryId})**!`,
        )
        .addFields({
          name: "Start Time",
          value: `<t:${Math.floor(eventData.data?.start_time || Date.now() / 1000)}:f>`,
          inline: true,
        });
      break;

    case "assault_succeeded":
      territoryId = eventData.war?.territory;
      involvedFactions.push(
        String(fAssaultingId),
        String(fDefendingId),
        String(fVictorId),
      );
      embed
        .setTitle(`Assault Succeeded: ${territoryId}`)
        .setColor(0x10b981) // Green
        .setDescription(
          `**[${nameVictor}](https://www.torn.com/factions.php?step=profile&ID=${fVictorId})** has successfully claimed **[${territoryId}](https://www.torn.com/city.php#terrName=${territoryId})**!`,
        )
        .addFields({
          name: "End Time",
          value: `<t:${Math.floor((eventData.war?.end_time || Date.now()) / 1000)}:f>`,
          inline: true,
        });
      break;

    case "assault_failed":
      territoryId = eventData.war?.territory;
      involvedFactions.push(String(fAssaultingId), String(fDefendingId));
      embed
        .setTitle(`Assault Failed: ${territoryId}`)
        .setColor(0xef4444) // Red
        .setDescription(
          `**[${nameAssaulting}](https://www.torn.com/factions.php?step=profile&ID=${fAssaultingId})** failed to assault **[${territoryId}](https://www.torn.com/city.php#terrName=${territoryId})**.`,
        )
        .addFields({
          name: "End Time",
          value: `<t:${Math.floor((eventData.war?.end_time || Date.now()) / 1000)}:f>`,
          inline: true,
        });
      break;

    case "peace_treaty":
      territoryId = eventData.war?.territory;
      involvedFactions.push(String(fAssaultingId), String(fDefendingId));
      embed
        .setTitle(`Peace Treaty: ${territoryId}`)
        .setColor(0x9ca3af) // Gray
        .setDescription(
          `The war on **[${territoryId}](https://www.torn.com/city.php#terrName=${territoryId})** ended in a truce.`,
        )
        .addFields({
          name: "End Time",
          value: `<t:${Math.floor((eventData.war?.end_time || Date.now()) / 1000)}:f>`,
          inline: true,
        });
      break;

    case "territory_drop":
      territoryId = eventData.territory;
      involvedFactions.push(String(fGeneralId));
      embed
        .setTitle(`Territory Abandoned: ${territoryId}`)
        .setColor(0x6b7280) // Dark Gray
        .setDescription(
          `**[${nameGeneral}](https://www.torn.com/factions.php?step=profile&ID=${fGeneralId || 0})** abandoned **[${territoryId}](https://www.torn.com/city.php#terrName=${territoryId})**.`,
        );
      break;

    case "territory_claim":
      territoryId = eventData.territory;
      involvedFactions.push(String(fGeneralId));
      embed
        .setTitle(`Territory Claimed: ${territoryId}`)
        .setColor(0x3b82f6) // Blue
        .setDescription(
          `**[${nameGeneral}](https://www.torn.com/factions.php?step=profile&ID=${fGeneralId || 0})** claimed **[${territoryId}](https://www.torn.com/city.php#terrName=${territoryId})**!`,
        );
      break;

    case "racket_changed":
      territoryId = eventData.territory;
      embed
        .setTitle(`Racket Update: ${territoryId}`)
        .setColor(0x8b5cf6) // Purple
        .setDescription(`The racket on **${territoryId}** has changed.`)
        .addFields(
          {
            name: "New Racket",
            value: eventData.new?.racket_name || "Unknown",
            inline: true,
          },
          {
            name: "Level",
            value: String(eventData.new?.racket_level || 0),
            inline: true,
          },
          {
            name: "Reward",
            value: eventData.new?.racket_reward || "Unknown",
            inline: true,
          },
        );
      break;

    default:
      logger.warn(`Unhandled territory event type: ${eventType}`);
      return;
  }

  // Filter out any invalid strings from involved factions
  const validFactions = involvedFactions.filter(
    (f) => f && f !== "undefined" && f !== "null",
  );

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
      const isTerritoryMatch = config.tt_territory_ids?.includes(territoryId);
      const isFactionMatch = config.tt_faction_ids?.some((fid) =>
        validFactions.includes(String(fid)),
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
}
