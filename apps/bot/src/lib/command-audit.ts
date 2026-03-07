/**
 * Command Audit Logging Module
 * Logs command invocations for administrative purposes
 */

import { ChatInputCommandInteraction } from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getDB } from "@sentinel/shared/db/sqlite.js";

/**
 * Log a command invocation to the audit table
 */
export async function logCommandAudit(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    const db = getDB();
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

    db.prepare(
      `INSERT INTO "${TABLE_NAMES.GUILD_AUDIT}" (guild_id, actor_discord_id, action, details)
       VALUES (?, ?, ?, ?)`,
    ).run(
      interaction.guildId ?? "dm",
      interaction.user.id,
      "command_invoked",
      JSON.stringify({
        command: interaction.commandName,
        options,
      }),
    );
  } catch (error) {
    console.warn("Failed to write command audit entry:", error);
  }
}
