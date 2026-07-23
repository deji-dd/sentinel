import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("tt-selector")
  .setDescription("Open the interactive Territory Selector tool");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const baseUrl = process.env.DASHBOARD_URL;
  const selectorUrl = `${baseUrl}/tt-selector`;

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("Sentinel Territory Selector")
    .setDescription(
      "Click the button below to open the interactive Territory Selector tool.",
    )
    .setFooter({ text: "Sentinel" })
    .setTimestamp();

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
    ephemeral: true,
  });
}
