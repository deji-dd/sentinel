import { Client, TextChannel, EmbedBuilder } from "discord.js";
import { db } from "@sentinel/database";
import { logger } from "./logger.js";

/**
 * Sends an audit log embed to the configured guild log channel if enabled.
 */
export async function sendGuildAuditLog(
  client: Client,
  guildId: string,
  embed: EmbedBuilder,
): Promise<void> {
  try {
    const config = await db.guildConfig.findUnique({
      where: { guildId },
      select: { logChannelId: true },
    });

    if (!config || !config.logChannelId) return;

    const channel = await client.channels
      .fetch(config.logChannelId)
      .catch(() => null);

    if (channel && channel instanceof TextChannel) {
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (error) {
    logger.warn(`Failed to send audit log for guild ${guildId}:`, error);
  }
}
