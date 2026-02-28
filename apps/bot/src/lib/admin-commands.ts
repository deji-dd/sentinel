/**
 * Admin Commands Handler Module
 * Manages authorization and execution of admin-only commands
 */

import { ChatInputCommandInteraction, Client, EmbedBuilder } from "discord.js";
import * as forceRunCommand from "../commands/personal/admin/force-run.js";
import * as deployCommandsCommand from "../commands/personal/admin/deploy-commands.js";
import * as setupGuildCommand from "../commands/personal/admin/setup-guild.js";
import * as teardownGuildCommand from "../commands/personal/admin/teardown-guild.js";
import * as addBotCommand from "../commands/personal/admin/add-bot.js";
import * as enableModuleCommand from "../commands/personal/admin/enable-module.js";
import * as removeModuleCommand from "../commands/personal/admin/remove-module.js";
import * as guildStatusCommand from "../commands/personal/admin/guild-status.js";

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
    case "force-run":
      await forceRunCommand.execute(interaction);
      break;
    case "deploy-commands":
      await deployCommandsCommand.execute(interaction, client);
      break;
    case "setup-guild":
      await setupGuildCommand.execute(interaction, client);
      break;
    case "teardown-guild":
      await teardownGuildCommand.execute(interaction, client);
      break;
    case "add-bot":
      await addBotCommand.execute(interaction);
      break;
    case "enable-module":
      await enableModuleCommand.execute(interaction, client);
      break;
    case "remove-module":
      await removeModuleCommand.execute(interaction, client);
      break;
    case "guild-status":
      await guildStatusCommand.execute(interaction, client);
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
    "force-run",
    "deploy-commands",
    "setup-guild",
    "teardown-guild",
    "add-bot",
    "enable-module",
    "remove-module",
    "guild-status",
    "test-verification-dms",
  ].includes(commandName);
}
