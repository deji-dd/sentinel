/**
 * ARCHIVED FILE — Admin Commands Handler Module
 * Moved from apps/bot/src/lib/admin-commands.ts during dashboard refactoring.
 */

import { ChatInputCommandInteraction, Client, EmbedBuilder } from "discord.js";
import * as inviteCommand from "../commands/personal/admin/invite.js";

function createUnauthorizedEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle("Not Authorized")
    .setDescription("You are not authorized to use this command.")
    .setFooter({ text: "Sentinel" })
    .setTimestamp();
}

function isAuthorized(
  userId: string,
  authorizedDiscordUserId: string,
): boolean {
  return userId === authorizedDiscordUserId;
}

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

  if (!isAuthorized(interaction.user.id, authorizedDiscordUserId)) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        embeds: [createUnauthorizedEmbed()],
      });
    }
    return true;
  }

  switch (commandName) {
    case "invite":
      await inviteCommand.execute(interaction);
      break;
  }

  return true;
}

export function isAdminCommandName(commandName: string): boolean {
  return [
    "invite",
  ].includes(commandName);
}
