import { Client, EmbedBuilder } from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "./db-client.js";

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
    const settings = await db
      .selectFrom(TABLE_NAMES.PERSONAL_SETTINGS as any)
      .selectAll()
      .executeTakeFirst();

    if (!settings || !settings.admin_log_channel_id) {
      return; // Log channel not configured
    }

    const channel = await client.channels.fetch(settings.admin_log_channel_id).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return; // Invalid or inaccessible channel
    }

    const color = level === "error" ? 0xef4444 : level === "warn" ? 0xf59e0b : 0x3b82f6;
    const title = level === "error" ? "System Error Alert" : level === "warn" ? "System Warning Alert" : "System Event Log";

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(message.substring(0, 2048))
      .setColor(color)
      .setFooter({ text: "Sentinel" })
      .setTimestamp();

    if (errorStack) {
      embed.addFields({
        name: "Details / Stack Trace",
        value: `\`\`\`x86asm\n${errorStack.substring(0, 1010)}\n\`\`\``,
      });
    }

    let content: string | undefined = undefined;
    if (level === "error" && settings.error_pings_enabled === 1) {
      content = `<@${settings.discord_id}>`;
    }

    let attempts = 3;
    while (attempts > 0) {
      try {
        await channel.send({
          content,
          embeds: [embed],
        });
        break;
      } catch (err: any) {
        attempts--;
        if (attempts === 0) {
          console.error("[AdminLogger] Failed to send log to Discord channel after 3 attempts. Last error:", err);
        } else {
          console.warn(`[AdminLogger] Transient error sending log to Discord channel (attempts remaining: ${attempts}): ${err?.message || err}. Retrying in 500ms...`);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
  } catch (err) {
    console.error("[AdminLogger] Failed to send log to Discord channel:", err);
  }
}
