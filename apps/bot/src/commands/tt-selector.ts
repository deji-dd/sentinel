import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { createBaseEmbed, EMBED_COLORS } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("tt-selector")
  .setDescription("Open the interactive Territory Selector tool");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const baseUrl = process.env.DASHBOARD_URL || "https://blasted-labs.tech";
  const selectorUrl = `${baseUrl}/tt-selector`;

  const embed = createBaseEmbed(
    "Territory Selector",
    "Click the button below to open the interactive Territory Selector tool.",
    EMBED_COLORS.PRIMARY,
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Open Territory Selector")
      .setStyle(ButtonStyle.Link)
      .setURL(selectorUrl)
      .setEmoji("🗺️"),
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}
