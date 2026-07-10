/**
 * Client Event Listeners Module
 * Manages Discord client events and initialization
 */

import { Client, Events } from "discord.js";
import { setupIpcServer } from "./ipc-listener.js";
import { Logger } from "@sentinel/shared";
// Note: We deleted db-client.js and TABLE_NAMES because the Bot no longer resets sync jobs.

const logger = new Logger("ClientEvents");

/**
 * Register client ready event handler
 */
export function registerClientReadyEvent(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Bot logged in as ${readyClient.user.tag}!`);

    // The Bot is now incredibly lightweight.
    // All background tasks, cron jobs, database sync resets, and tracker modules
    // have been successfully offloaded to the isolated Node.js Worker processes.

    // We only need to ensure the IPC (Inter-Process Communication) Listener is active
    // so the Bot can receive and render UI commands from the Workers.
    setupIpcServer(readyClient);
  });
}
