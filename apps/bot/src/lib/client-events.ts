/**
 * Client Event Listeners Module
 * Manages Discord client events and initialization
 */

import { Client, Events } from "discord.js";
import { initHttpServer } from "./http-server.js";
import { GuildSyncScheduler } from "./verification-sync.js";
import { WarTrackerScheduler } from "./war-tracker-scheduler.js";
import { isDev, getHttpPort } from "./bot-config.js";

/**
 * Register client ready event handler
 */
export function registerClientReadyEvent(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Bot is online as ${readyClient.user.tag}`);

    // Start HTTP server for worker communication
    const httpPort = getHttpPort();
    initHttpServer(client, httpPort);

    // Start periodic guild sync scheduler
    const guildSyncScheduler = new GuildSyncScheduler(client);
    guildSyncScheduler.start();

    // Start war tracker scheduler
    const warTrackerScheduler = new WarTrackerScheduler(client);
    warTrackerScheduler.start();
  });
}
