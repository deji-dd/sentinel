/**
 * Client Event Listeners Module
 * Manages Discord client events and initialization
 */

import { Client, Events, EmbedBuilder } from "discord.js";
import { setupIpcServer } from "./ipc/index.js";
import { startAutoVerifyCron } from "./auto-verify.js";
import { syncReactionRoleMessages } from "./reaction-roles.js";
import { Logger, SystemState, SystemStateDocument } from "@sentinel/shared";
// Note: We deleted db-client.js and TABLE_NAMES because the Bot no longer resets sync jobs.

const logger = new Logger("ClientEvents");

type State = Extract<SystemStateDocument, { reported: boolean }>;

/**
 * Register client ready event handler
 */
export function registerClientReadyEvent(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Bot logged in as ${readyClient.user.tag}!`);

    // The Bot is now incredibly lightweight.
    // All background tasks, cron jobs, database sync resets, and tracker modules
    // have been successfully offloaded to the isolated Node.js Worker processes.

    // so the Bot can receive and render UI commands from the Workers.
    setupIpcServer(readyClient);

    // Start the background loop that fetches all guild members and pipes them to the worker
    startAutoVerifyCron(readyClient);

    // Sync reaction role messages on startup
    void syncReactionRoleMessages(readyClient);

    // Background interval to process pending system boot alerts and reaction role syncs
    setInterval(async () => {
      void syncReactionRoleMessages(readyClient);
      try {
        const unreported = SystemState.find({ reported: false }) as State[];

        if (unreported.length === 0) return;

        const ownerId = process.env.SENTINEL_DISCORD_USER_ID;
        if (!ownerId) return;

        const owner = await readyClient.users.fetch(ownerId).catch(() => null);
        if (!owner) return;

        for (const alert of unreported) {
          const embed = new EmbedBuilder()
            .setTitle("System Boot Event")
            .setDescription(alert.message)
            .setColor(0x00ff00)
            .setFooter({ text: "Sentinel" })
            .setTimestamp();

          await owner.send({ embeds: [embed] });

          SystemState.update({ ...alert, reported: true });
        }
      } catch (error) {
        logger.error("Failed to process system alerts", error);
      }
    }, 15000);
  });
}
