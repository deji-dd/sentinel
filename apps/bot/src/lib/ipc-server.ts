import net from "net";
import fs from "fs";
import { type Client } from "discord.js";
import { Logger } from "./logger.js";
import { performBackup } from "../tasks/db-backup-task.js";
import { performDailySummary } from "../tasks/daily-summary-task.js";
import { performTokenCleanup } from "../tasks/token-cleanup-task.js";
import { performReviveMaintenance } from "../commands/general/admin/handlers/revive.js";
import { GuildSyncScheduler } from "./verification-sync.js";
import { runWarTrackerGuildSync } from "./war-tracker.js";
import { runMercenaryTrackerGuildSync } from "./mercenary-tracker.js";

const logger = new Logger("IPC_Server");
const DEFAULT_SOCKET_PATH = "/tmp/sentinel-ipc.sock";

export function startIpcServer(discordClient: Client): net.Server {
  const socketPath = process.env.IPC_SOCKET_PATH || DEFAULT_SOCKET_PATH;

  // Ensure any previous socket file is removed
  if (fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch (err) {
      logger.error(`Failed to unlink stale socket file at ${socketPath}:`, err);
    }
  }

  const server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", async (data) => {
      buffer += data.toString("utf8");

      // Messages are newline-delimited JSON
      if (buffer.includes("\n")) {
        const lines = buffer.split("\n");
        // Keep the last partial line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const request = JSON.parse(line);
            const response = await handleIpcRequest(request, discordClient);
            socket.write(JSON.stringify(response) + "\n");
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            socket.write(
              JSON.stringify({
                success: false,
                error: "Invalid request format or execution error",
                details: message,
              }) + "\n",
            );
          }
        }
      }
    });

    socket.on("error", (err) => {
      // Ignore connection resets / client disconnects
      if ((err as { code?: string }).code !== "ECONNRESET") {
        logger.error("IPC Socket error:", err);
      }
    });
  });

  server.listen(socketPath, () => {
    logger.info(`IPC Server listening on Unix Domain Socket: ${socketPath}`);
    // Set permissions so both bot and worker can read/write to the socket
    try {
      fs.chmodSync(socketPath, "0660");
    } catch (err) {
      logger.warn(`Failed to set permissions on socket: ${err}`);
    }
  });

  server.on("error", (err) => {
    logger.error("IPC Server error:", err);
  });

  const cleanup = () => {
    try {
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
    } catch {
      // Ignore cleanup error on exit
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  return server;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleIpcRequest(req: any, client: Client): Promise<any> {
  const { action, payload } = req;

  if (!action) {
    return { success: false, error: "Missing action parameter" };
  }

  try {
    switch (action) {
      case "send-guild-message": {
        const { guildId, channelId, embed, content } = payload || {};
        if (!guildId || !channelId) {
          return { success: false, error: "Missing guildId or channelId" };
        }
        const guild = await client.guilds.fetch(guildId);
        if (!guild) return { success: false, error: "Guild not found" };

        const channel = await guild.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
          return { success: false, error: "Text channel not found" };
        }

        await channel.send({
          content: content || undefined,
          embeds: embed ? [embed] : undefined,
        });

        return { success: true, guild: guild.name, channel: channel.name };
      }

      case "send-dm": {
        const { discordId, embed } = payload || {};
        if (!discordId || !embed) {
          return { success: false, error: "Missing discordId or embed" };
        }
        const user = await client.users.fetch(discordId);
        if (!user) return { success: false, error: "Discord user not found" };

        await user.send({ embeds: [embed] });
        return { success: true, recipient: user.tag };
      }

      case "execute-job": {
        const { workerName, metadata } = payload || {};
        if (!workerName) {
          return { success: false, error: "Missing workerName" };
        }

        const guildId = metadata?.guildId;

        if (workerName === "bot:daily_summary") {
          await performDailySummary(client);
        } else if (workerName === "bot:db_backup") {
          await performBackup(client);
        } else if (workerName === "bot:token_cleanup") {
          await performTokenCleanup();
        } else if (workerName === "bot:revive_maintenance") {
          await performReviveMaintenance(client);
        } else if (workerName.startsWith("bot:auto_verify:")) {
          if (!guildId) {
            return { success: false, error: "Missing guildId metadata" };
          }
          const scheduler = new GuildSyncScheduler(client);
          await scheduler.runGuildOnce(guildId);
        } else if (workerName.startsWith("bot:war_tracker:")) {
          if (!guildId) {
            return { success: false, error: "Missing guildId metadata" };
          }
          await runWarTrackerGuildSync(client, guildId);
        } else if (workerName.startsWith("bot:mercenary_tracker:")) {
          if (!guildId) {
            return { success: false, error: "Missing guildId metadata" };
          }
          await runMercenaryTrackerGuildSync(client, guildId);
        } else {
          return { success: false, error: `Unknown worker job '${workerName}'` };
        }

        return { success: true };
      }

      default:
        return { success: false, error: `Unknown IPC action '${action}'` };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`Error in IPC request execution for action '${action}':`, err);
    return { success: false, error: "Execution error", details: errorMsg };
  }
}
