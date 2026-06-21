import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("finance")
  .setDescription("Show your latest finance snapshot")
  .setIntegrationTypes([0, 1])
  .setContexts([0, 1, 2]);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ content: "Finance command is under reconstruction.", ephemeral: true });
}
