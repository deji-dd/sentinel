import { EmbedBuilder, ChannelType, type Client } from "discord.js";
import { GuildConfigs } from "@sentinel/shared";

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
 * @param options Log message options
 */
export async function logGuildAction(
  guildId: string,
  client: Client,
  options: GuildLogOptions,
): Promise<void> {
  try {
    // Fetch guild config from fast NoSQL memory to get log channel ID
    const guildConfig = GuildConfigs.find({ guild_id: guildId })[0];

    if (
      !guildConfig?.log_channel_id ||
      !/^\d{17,20}$/.test(guildConfig.log_channel_id)
    ) {
      // Guild doesn't have logging enabled or it is not a valid snowflake, skip silently
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
      .setFooter({ text: "Sentinel Auto-Diagnostics" })
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

/**
 * Route system logs and errors directly to the configured Discord admin channel
 */
export async function sendAdminSystemLog(
  client: Client,
  level: "info" | "warn" | "error",
  message: string,
  errorStack?: string,
): Promise<void> {
  try {
    const adminGuildId = process.env.ADMIN_GUILD_ID;
    if (!adminGuildId) return;

    const guildConfig = GuildConfigs.findOne(adminGuildId);
    if (!guildConfig || !guildConfig.log_channel_id) {
      return; // Admin log channel not configured
    }

    const channel = await client.channels
      .fetch(guildConfig.log_channel_id)
      .catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return; // Invalid or inaccessible channel
    }

    const color =
      level === "error" ? 0xef4444 : level === "warn" ? 0xf59e0b : 0x3b82f6;
    const title =
      level === "error"
        ? "System Error Alert"
        : level === "warn"
          ? "System Warning Alert"
          : "System Event Log";

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(message.substring(0, 2048))
      .setColor(color)
      .setFooter({ text: "Sentinel System" })
      .setTimestamp();

    if (errorStack) {
      embed.addFields({
        name: "Details / Stack Trace",
        value: `\`\`\`x86asm\n${errorStack.substring(0, 1010)}\n\`\`\``,
      });
    }

    // Ping the admin roles if it's an error
    let content: string | undefined = undefined;
    if (level === "error" && guildConfig.admin_role_ids?.length > 0) {
      content = guildConfig.admin_role_ids.map((id) => `<@&${id}>`).join(" ");
    }

    let attempts = 3;
    while (attempts > 0) {
      try {
        await channel.send({
          content,
          embeds: [embed],
        });
        break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        attempts--;
        if (attempts === 0) {
          console.error(
            "[SystemLogger] Failed to send log to Discord channel after 3 attempts. Last error:",
            err,
          );
        } else {
          console.warn(
            `[SystemLogger] Transient error sending log to Discord channel (attempts remaining: ${attempts}): ${err?.message || err}. Retrying in 500ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
  } catch (err) {
    console.error("[SystemLogger] Failed to send log to Discord channel:", err);
  }
}
