/**
 * Command Audit Logging Module
 * Logs command invocations for administrative purposes
 */

import { ChatInputCommandInteraction } from "discord.js";
import { randomUUID } from "crypto";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "./db-client.js";

/**
 * Log a command invocation to the audit table
 */
export async function logCommandAudit(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    const options = interaction.options.data.map((option) => {
      const value = option.value;
      const safeValue =
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
          ? value
          : value
            ? String(value)
            : null;
      return { name: option.name, value: safeValue };
    });

    await db
      .insertInto(TABLE_NAMES.GUILD_AUDIT)
      .values({
        id: randomUUID(),
        guild_id: interaction.guildId ?? "dm",
        actor_discord_id: interaction.user.id,
        action: "command_invoked",
        details: JSON.stringify({
          command: interaction.commandName,
          options,
        }),
      })
      .execute();
  } catch (error) {
    console.warn("Failed to write command audit entry:", error);
  }
}
