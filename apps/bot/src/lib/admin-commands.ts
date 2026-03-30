/**
 * Admin Commands Handler Module
 * Manages authorization and execution of admin-only commands
 */

import { ChatInputCommandInteraction, Client, EmbedBuilder } from "discord.js";
import * as forceRunCommand from "../commands/personal/admin/force-run.js";
import * as botAdminCommand from "../commands/personal/admin/bot-admin.js";
import * as deployCommandsCommand from "../commands/personal/admin/deploy-commands.js";
import * as addBotCommand from "../commands/personal/admin/add-bot.js";
import * as dbBackupCommand from "../commands/personal/admin/db-backup.js";
import * as revokeWebAccessCommand from "../commands/personal/admin/revoke-web-access.js";

/**
 * Create an "Not Authorized" error embed
 */
function createUnauthorizedEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle("❌ Not Authorized")
    .setDescription("You are not authorized to use this command.");
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
  client: Client,
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
    case "bot-admin":
      await botAdminCommand.execute(interaction);
      break;
    case "force-run":
      await forceRunCommand.execute(interaction);
      break;
    case "deploy-commands":
      await deployCommandsCommand.execute(interaction, client);
      break;
    case "add-bot":
      await addBotCommand.execute(interaction);
      break;
    case "db-backup":
      await dbBackupCommand.execute(interaction, client);
      break;
    case "revoke-web-access":
      await revokeWebAccessCommand.execute(interaction);
      break;
    case "test-verification-dms":
      // Placeholder for test command
      break;
  }

  return true;
}

/**
 * Check if a command name is an admin-only command
 */
export function isAdminCommandName(commandName: string): boolean {
  return [
    "bot-admin",
    "force-run",
    "deploy-commands",
    "add-bot",
    "db-backup",
    "test-verification-dms",
    "revoke-web-access",
  ].includes(commandName);
}
