 
/**
 * Admin Commands Handler Module
 * Manages authorization and execution of admin-only commands
 */

import { ChatInputCommandInteraction, Client, EmbedBuilder } from "discord.js";
import * as adminCommand from "../commands/general/admin/admin.js";
import * as inviteCommand from "../commands/personal/admin/invite.js";

/**
 * Create an "Not Authorized" error embed
 */
function createUnauthorizedEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle("Not Authorized")
    .setDescription("You are not authorized to use this command.")
    .setFooter({ text: "Sentinel" })
    .setTimestamp();
}

/**
 * Check if user is authorized to use admin commands
 */
function isAuthorized(
  userId: string,
  authorizedDiscordUserId: string,
): boolean {
  return userId === authorizedDiscordUserId;
}

/**
 * Handle admin-only commands
 */
export async function handleAdminCommand(
  interaction: ChatInputCommandInteraction,
  authorizedDiscordUserId: string,
  _client: Client,
): Promise<boolean> {
  const commandName = interaction.commandName;
  const isAdminCommand = isAdminCommandName(commandName);

  if (!isAdminCommand) {
    return false;
  }

  // Check authorization
  if (!isAuthorized(interaction.user.id, authorizedDiscordUserId)) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        embeds: [createUnauthorizedEmbed()],
      });
    }
    return true;
  }

  // Execute the appropriate admin command
  switch (commandName) {
    case "admin":
      await adminCommand.execute(interaction);
      break;
    case "invite":
      await inviteCommand.execute(interaction);
      break;
  }

  return true;
}

/**
 * Check if a command name is an admin-only command
 */
export function isAdminCommandName(commandName: string): boolean {
  return [
    "admin",
    "invite",
  ].includes(commandName);
}
