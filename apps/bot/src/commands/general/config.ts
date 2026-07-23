import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription(
    "Open the web dashboard to configure Sentinel for this server",
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  const baseUrl = process.env.DASHBOARD_URL;

  const dashboardUrl = guildId ? `${baseUrl}/guilds/${guildId}` : baseUrl;

  const embed = new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle("Sentinel Web Dashboard")
    .setDescription(
      "Server configuration has moved to our interactive web dashboard. Click the button below to configure bot for this server.",
    )
    .setFooter({ text: "Sentinel" })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Open Server Dashboard")
      .setStyle(ButtonStyle.Link)
      .setURL(dashboardUrl)
      .setEmoji("⚙️"),
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
}
