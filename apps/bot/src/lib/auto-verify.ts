import { Client } from "discord.js";
import { GuildConfigs, Logger } from "@sentinel/shared";
import { dispatchToWorker } from "./ipc/index.js";

const logger = new Logger("auto_verify_cron");

export function startAutoVerifyCron(client: Client) {
  // Run every 1 hour (3,600,000 milliseconds)
  const ONE_HOUR = 60 * 60 * 1000;

  setInterval(async () => {
    logger.info("Starting hourly auto-verify sweep...");

    try {
      // Find all guilds that have opted into auto-verify
      const configs = GuildConfigs.find({ auto_verify: true });

      for (const config of configs) {
        try {
          const guild = await client.guilds
            .fetch(config.guild_id)
            .catch(() => null);
          if (!guild) continue;

          const members = await guild.members.fetch();
          const humanMembers = members.filter((m) => !m.user.bot);

          // Map them to the IPC VerificationRequest schema
          const jobs = humanMembers.map((member) => ({
            guild_id: guild.id,
            // Fallback to the guild's log channel for bot response rendering, if available
            channel_id: config.log_channel_id || "", 
            discord_id: member.id,
            current_role_ids: Array.from(member.roles.cache.keys()),
            current_nickname: member.nickname || null,
          }));

          if (jobs.length > 0) {
            // Dispatch perfectly to the Worker's verify_bulk queue!
            dispatchToWorker({ action: "verify_bulk", data: jobs });
            logger.info(
              `Dispatched ${jobs.length} auto-verify jobs for guild ${guild.name}`,
            );
          }
        } catch (err) {
          logger.error(`Failed to auto-verify guild ${config.guild_id}`, err);
        }
      }
    } catch (err) {
      logger.error("Auto-verify cron failed", err);
    }
  }, ONE_HOUR);
}
