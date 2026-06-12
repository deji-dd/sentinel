/**
 * Client Event Listeners Module
 * Manages Discord client events and initialization
 */

import { Client, Events } from "discord.js";
import { initHttpServer } from "./http-server.js";
import { getHttpPort } from "./bot-config.js";
import {
  syncAutoVerifyCronSchedules,
  syncGlobalCronSchedules,
  syncWarTrackerCronSchedules,
} from "./cron-schedule-registry.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "./db-client.js";

import { Logger } from "./logger.js";

const logger = new Logger("Bot");

/**
 * Register client ready event handler
 */
export function registerClientReadyEvent(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    logger.success(`Online as ${readyClient.user.tag}`);

    // Reset any stuck guild sync jobs from previous crashes/restarts
    db.updateTable(TABLE_NAMES.GUILD_SYNC_JOBS)
      .set({ in_progress: 0 })
      .where("in_progress", "=", 1)
      .execute()
      .then((res) => {
        const affected = Number(res[0]?.numUpdatedRows);
        if (affected > 0) {
          logger.info(`Reset ${affected} stuck guild sync job(s) from database lock state on startup`);
        }
      })
      .catch((err) => {
        logger.error("Failed to reset stuck guild sync jobs on startup", err);
      });

    // Start HTTP server for worker communication
    const httpPort = getHttpPort();
    initHttpServer(client, httpPort);

    void syncGlobalCronSchedules();
    void syncAutoVerifyCronSchedules(readyClient);
    void syncWarTrackerCronSchedules();
  });
}
