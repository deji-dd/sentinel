import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("finance-settings")
  .setDescription("Configure your finance settings")
  .setIntegrationTypes([0, 1])
  .setContexts([0, 1, 2]);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ content: "Finance settings command is under reconstruction.", ephemeral: true });
}
