/**
 * Command Audit Logging Module
 * Logs command invocations for administrative purposes
 */

import { ChatInputCommandInteraction } from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { supabase } from "./supabase.js";

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

    await supabase.from(TABLE_NAMES.GUILD_AUDIT).insert({
      guild_id: interaction.guildId ?? "dm",
      actor_discord_id: interaction.user.id,
      action: "command_invoked",
      details: {
        command: interaction.commandName,
        options,
      },
    });
  } catch (error) {
    console.warn("Failed to write command audit entry:", error);
  }
}
