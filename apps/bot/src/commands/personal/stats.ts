import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("View your battlestats progress")
  .setIntegrationTypes([0, 1])
  .setContexts([0, 1, 2]);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ content: "Stats command is under reconstruction.", ephemeral: true });
}
