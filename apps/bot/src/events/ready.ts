import { Events, ActivityType, type Client } from "discord.js";
import { recordBootAlert } from "@sentinel/database";
import { logger } from "../lib/logger.js";
import { startBootAlertNotifier } from "../lib/boot-notifier.js";
import { startReactionRoleSyncLoop } from "../lib/reaction-roles.js";
import { updateFactionMapChannel } from "../lib/faction-map-channel.js";

export const readyEvent = {
  name: Events.ClientReady,
  once: true,
  async execute(client: Client): Promise<void> {
    if (!client.user) return;

    logger.info(`Discord Bot logged in as ${client.user.tag}`);
    client.user.setActivity("Sentinel", {
      type: ActivityType.Watching,
    });

    // Record bot boot event
    await recordBootAlert("bot");

    // Start background notifier for process boot alerts (bot, worker, api)
    startBootAlertNotifier(client);

    // Synchronize and start background periodic loop for reaction role messages (every 15s)
    startReactionRoleSyncLoop(client, 15000);

    // Synchronize Faction Map / Directory Channels across all guilds
    await updateFactionMapChannel(client);
  },
} as const;

