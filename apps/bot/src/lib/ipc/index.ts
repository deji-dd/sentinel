import { Client } from "discord.js";
import {
  Logger,
  IpcServer,
  toBotPacket,
  IpcClient,
  toWorkerPacket,
} from "@sentinel/shared";
import { handleTerritoryEvent } from "./tt-event-handler.js";
import { constants } from "@sentinel/shared";
import { handleVerificationEvent } from "./verification-event-handler.js";

const logger = new Logger("bot_ipc");

export const workerIpcClient = new IpcClient(constants.worker_ipc_path);

export function dispatchToWorker(packet: toWorkerPacket) {
  workerIpcClient.send(packet);
}

export function setupIpcServer(client: Client): void {
  const socketPath = constants.bot_ipc_path;
  const ipcServer = new IpcServer(socketPath, async (packet: toBotPacket) => {
    const { action } = packet;

    const finishSync = logger.time();

    const tt_actions = [
      "peace_treaty",
      "assault_succeed",
      "assault_fail",
      "assault_start",
      "tt_drop",
      "tt_claim",
      "racket_spawn",
      "racket_despawn",
      "racket_level_up",
      "racket_level_down",
    ];

    try {
      if (tt_actions.includes(action)) {
        await handleTerritoryEvent(client, packet, finishSync, logger);
        return;
      }

      if (action === "verification_fail" || action === "verification_success") {
        await handleVerificationEvent(client, packet, logger, finishSync);
        return;
      }

      logger.warn(`Unknown IPC action received: ${action}`);

      //   try {
      //

      //     if (payload.status === "success") {
      //       // 1. Update Nickname
      //

      //       // 2. Add Valid Roles
      //
      //

      //       // 3. Remove Invalid Roles
      //
      //     }

      //     // 4. Optionally send a DM to the user with the result if provided
      //     if (payload.dmEmbed) {
      //       await member
      //         .send({ embeds: [payload.dmEmbed] })
      //         .catch(() => null);
      //     }
      //   } catch (error) {
      //     logger.error(
      //       `Failed to apply verification state for ${payload.discordId}`,
      //       error,
      //     );
      //
      //   }
      //   break;
      // }

      // case "SEND_DM": {
      //   const user = await client.users.fetch(payload.discordId);
      //   if (user) await user.send({ embeds: [payload.embed] });
      //   break;
      // }

      // case "BAZAAR_DROP_DETECTED": {
      //   const channel = (await client.channels
      //     .fetch(payload.channelId)
      //     .catch(() => null)) as TextChannel;
      //   if (!channel) return;

      //   const embed = new EmbedBuilder()
      //     .setTitle("🚨 Bazaar Drop Detected!")
      //     .setColor(0xef4444) // Bright Red
      //     .setDescription(
      //       `**[${payload.playerName} [${payload.playerId}]](https://www.torn.com/profiles.php?XID=${payload.playerId})** just dropped their bazaar value!`,
      //     )
      //     .addFields(
      //       {
      //         name: "Previous Value",
      //         value: `$${payload.pastVal.toLocaleString()}`,
      //         inline: true,
      //       },
      //       {
      //         name: "Current Value",
      //         value: `$${payload.currentVal.toLocaleString()}`,
      //         inline: true,
      //       },
      //       {
      //         name: "Drop Amount",
      //         value: `**-$${payload.dropAmount.toLocaleString()}**`,
      //         inline: true,
      //       },
      //     )
      //     .setTimestamp();

      //   // Ping the role if the guild configured one
      //   const content = payload.pingRoleId
      //     ? `<@&${payload.pingRoleId}>`
      //     : undefined;
      //   await channel.send({ content, embeds: [embed] });
      //   break;
      // }

      // case "BAZAAR_DASHBOARD_UPDATE": {
      //   if (!payload.messageId || !payload.channelId) return;

      //   const channel = (await client.channels
      //     .fetch(payload.channelId)
      //     .catch(() => null)) as TextChannel;
      //   if (!channel) return;

      //   const message = await channel.messages
      //     .fetch(payload.messageId)
      //     .catch(() => null);
      //   if (!message) return;

      //   // Format the live leaderboard
      //   const sortedTargets = payload.targets.sort(
      //     // eslint-disable-next-line @typescript-eslint/no-explicit-any
      //     (a: any, b: any) => b.value - a.value,
      //   );
      //   let description = "Live tracking of targeted bazaars.\n\n";

      //   for (const t of sortedTargets) {
      //     const statusEmoji = t.isOnline ? "🟢" : "⚪";
      //     description += `${statusEmoji} **[${t.name} [${t.playerId}]]** — \`$${t.value.toLocaleString()}\`\n`;
      //     description += `└ *Status: ${t.status}*\n\n`;
      //   }

      //   const embed = new EmbedBuilder()
      //     .setTitle("📊 Live Bazaar Tracker")
      //     .setColor(0x3b82f6) // Blue
      //     .setDescription(description || "No active targets.")
      //     .setFooter({ text: "Last updated" })
      //     .setTimestamp();

      //   await message.edit({ embeds: [embed] });
      //   break;
      // }

      // case "SYSTEM_ERROR": {
      //   // Allows background workers to report failures directly to Discord Admins
      //   await logGuildError(
      //     payload.guildId,
      //     client,
      //     `⚙️ System Error: ${payload.title}`,
      //     payload.description,
      //   );
      //   break;
      // }

      // }
    } catch (err) {
      logger.error(`Failed to handle '${action}':`, err);
    }
  });

  ipcServer.start();
}
