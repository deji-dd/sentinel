import { EmbedBuilder, ChannelType, type Client } from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getDB } from "@sentinel/shared/db/sqlite.js";

export interface GuildLogOptions {
  title: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  error?: string;
}

/**
 * Send a log message to the guild's configured log channel
 * @param guildId Discord guild ID
 * @param client Discord client for fetching channel
 * @param db database client for fetching config
 * @param options Log message options
 */
export async function logGuildAction(
  guildId: string,
  client: Client,

  options: GuildLogOptions,
): Promise<void> {
  try {
    const db = getDB();
    // Fetch guild config to get log channel ID
    const guildConfig = db
      .prepare(
        `SELECT log_channel_id FROM "${TABLE_NAMES.GUILD_CONFIG}" WHERE guild_id = ? LIMIT 1`,
      )
      .get(guildId) as { log_channel_id: string | null } | undefined;

    if (!guildConfig?.log_channel_id) {
      // Guild doesn't have logging enabled, skip silently
      return;
    }

    // Fetch the channel
    const channel = await client.channels.fetch(guildConfig.log_channel_id);
    const botUser = client.user;

    if (!botUser) {
      return;
    }

    if (channel?.type !== ChannelType.GuildText) {
      console.warn(
        `[Guild Logger] Channel ${guildConfig.log_channel_id} is not a text channel in guild ${guildId}`,
      );
      return;
    }

    const permissions = channel.permissionsFor(botUser);
    if (!permissions?.has("SendMessages")) {
      console.warn(
        `[Guild Logger] Cannot send log to channel ${guildConfig.log_channel_id} in guild ${guildId}`,
      );
      return;
    }

    // Build the embed
    const embed = new EmbedBuilder()
      .setColor(options.color ?? 0x3b82f6)
      .setTitle(options.title)
      .setTimestamp();

    if (options.description) {
      embed.setDescription(options.description);
    }

    if (options.error) {
      embed.addFields({
        name: "Error",
        value: `\`\`\`${options.error}\`\`\``,
        inline: false,
      });
    }

    if (options.fields && options.fields.length > 0) {
      embed.addFields(...options.fields);
    }

    // Send the log
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("[Guild Logger] Error sending log:", error);
    // Don't throw - logging failure shouldn't break bot functionality
  }
}

/**
 * Log a successful action to the guild's log channel
 */
export async function logGuildSuccess(
  guildId: string,
  client: Client,

  title: string,
  description?: string,
  fields?: Array<{ name: string; value: string; inline?: boolean }>,
): Promise<void> {
  await logGuildAction(guildId, client, {
    title,
    description,
    color: 0x22c55e,
    fields,
  });
}

/**
 * Log an error to the guild's log channel
 */
export async function logGuildError(
  guildId: string,
  client: Client,

  title: string,
  error: Error | string,
  description?: string,
): Promise<void> {
  const errorMessage =
    typeof error === "string" ? error : error.message || String(error);

  await logGuildAction(guildId, client, {
    title,
    description,
    color: 0xef4444,
    error: errorMessage,
  });
}

/**
 * Log a warning to the guild's log channel
 */
export async function logGuildWarning(
  guildId: string,
  client: Client,

  title: string,
  description?: string,
  fields?: Array<{ name: string; value: string; inline?: boolean }>,
): Promise<void> {
  await logGuildAction(guildId, client, {
    title,
    description,
    color: 0xf59e0b,
    fields,
  });
}
