import { Client } from "discord.js";
import { db } from "@sentinel/database";
import { logger } from "./logger.js";
import { createSuccessEmbed } from "./embeds.js";

/**
 * Checks for pending system boot alerts in the database and sends DMs to the bot owner.
 *
 * @param client - The Discord Client instance
 */
export async function processPendingBootAlerts(client: Client): Promise<void> {
  const ownerId =
    process.env.SENTINEL_DISCORD_USER_ID || process.env.DISCORD_OWNER_ID;

  if (!ownerId) {
    logger.warn(
      "[BootNotifier] Neither SENTINEL_DISCORD_USER_ID nor DISCORD_OWNER_ID environment variables are set. Skipping owner boot DM alert.",
    );
    return;
  }

  try {
    const pendingAlerts = await db.systemState.findMany({
      where: {
        id: { startsWith: "boot_alert_" },
        init: false,
      },
      orderBy: { createdAt: "asc" },
    });

    if (pendingAlerts.length === 0) return;

    const owner = await client.users.fetch(ownerId).catch((err) => {
      logger.error(
        `[BootNotifier] Failed to fetch Discord user ${ownerId}:`,
        err,
      );
      return null;
    });

    if (!owner) return;

    for (const alert of pendingAlerts) {
      const alertData = alert.data as {
        component?: string;
        message?: string;
        timestamp?: number;
      } | null;

      const componentName = alertData?.component || "System Component";
      const messageText = alertData?.message || "Process started or restarted.";
      const bootTime = alertData?.timestamp
        ? new Date(alertData.timestamp)
        : alert.createdAt;

      const embed = createSuccessEmbed(
        "System Boot Event",
        messageText,
      ).addFields(
        { name: "Component", value: `\`${componentName}\``, inline: true },
        {
          name: "Boot Time",
          value: `<t:${Math.floor(bootTime.getTime() / 1000)}:F>`,
          inline: true,
        },
      );

      try {
        await owner.send({ embeds: [embed] });
        await db.systemState.update({
          where: { id: alert.id },
          data: { init: true },
        });
        logger.info(
          `[BootNotifier] Delivered boot alert DM to owner for component: ${componentName}`,
        );
      } catch (sendErr) {
        logger.error(
          `[BootNotifier] Failed to send boot DM to owner for alert ${alert.id}:`,
          sendErr,
        );
      }
    }
  } catch (err) {
    logger.error("[BootNotifier] Error while processing boot alerts:", err);
  }
}

/**
 * Starts periodic polling for pending system boot alerts.
 *
 * @param client - The Discord Client instance
 * @param intervalMs - Polling interval in milliseconds (default 15,000ms)
 */
export function startBootAlertNotifier(
  client: Client,
  intervalMs = 15000,
): NodeJS.Timeout {
  void processPendingBootAlerts(client);

  return setInterval(() => {
    void processPendingBootAlerts(client);
  }, intervalMs);
}
