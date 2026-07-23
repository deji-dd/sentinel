import { Client } from "discord.js";
import { GuildConfigs, Logger } from "@sentinel/shared";
import { dispatchToWorker } from "./ipc/index.js";

const logger = new Logger("auto_verify_cron");

export function startAutoVerifyCron(client: Client) {
  // Run sweep checker every 5 minutes
  const CHECK_INTERVAL = 5 * 60 * 1000;

  setInterval(async () => {
    logger.info("Checking pending auto-verify cron tasks...");

    try {
      // Find all configs with verify_cron enabled
      const configs = GuildConfigs.find({ verify_cron: true });

      for (const config of configs) {
        try {
          const intervalHours =
            typeof config.verify_cron_interval === "number"
              ? config.verify_cron_interval
              : 1;
          const intervalMs = intervalHours * 60 * 60 * 1000;
          const lastRun = config.last_verify_cron_at || 0;

          if (Date.now() - lastRun < intervalMs) {
            continue;
          }

          logger.info(
            `Starting auto-verify sweep for guild ${config.guild_id} (Interval: ${intervalHours}h)...`,
          );

          const guild = await client.guilds
            .fetch(config.guild_id)
            .catch(() => null);
          if (!guild) continue;

          const members = await guild.members.fetch();
          const humanMembers = members.filter((m) => !m.user.bot);

          // Map them to the IPC VerificationRequest schema
          const jobs = humanMembers.map((member) => ({
            guild_id: guild.id,
            channel_id: config.log_channel_id || "",
            discord_id: member.id,
            current_role_ids: Array.from(member.roles.cache.keys()),
            current_nickname: member.nickname || null,
          }));

          if (jobs.length > 0) {
            dispatchToWorker({ action: "verify_bulk", data: jobs });
            logger.info(
              `Dispatched ${jobs.length} auto-verify jobs for guild ${guild.name}`,
            );
          }

          // Update last run timestamp
          GuildConfigs.update({
            ...config,
            last_verify_cron_at: Date.now(),
          });
        } catch (err) {
          logger.error(`Failed to auto-verify guild ${config.guild_id}`, err);
        }
      }
    } catch (err) {
      logger.error("Auto-verify cron failed", err);
    }
  }, CHECK_INTERVAL);
}
