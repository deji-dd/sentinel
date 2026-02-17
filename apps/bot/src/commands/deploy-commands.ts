import { SlashCommandBuilder, EmbedBuilder, REST, Routes } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("deploy-commands")
  .setDescription("Deploy/register all bot commands with Discord");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.deferReply();

    const isDev = process.env.NODE_ENV === "development";
    const token = isDev
      ? process.env.DISCORD_BOT_TOKEN_LOCAL
      : process.env.DISCORD_BOT_TOKEN;
    const clientId = isDev
      ? process.env.DISCORD_CLIENT_ID_LOCAL
      : process.env.DISCORD_CLIENT_ID;

    if (!token || !clientId) {
      await interaction.editReply({
        content: "❌ Missing Discord credentials in environment variables",
      });
      return;
    }

    const rest = new REST({ version: "10" }).setToken(token);

    // Dynamic import of all command files
    const financeCommand = await import("./finance.js");
    const financeSettingsCommand = await import("./finance-settings.js");
    const forceRunCommand = await import("./force-run.js");
    const settingsBuildCommand = await import("./settings-build.js");

    const commands = [
      financeCommand.data.toJSON(),
      financeSettingsCommand.data,
      forceRunCommand.data.toJSON(),
      settingsBuildCommand.data.toJSON(),
    ];

    const progressEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("⏳ Deploying Commands")
      .setDescription("Registering slash commands with Discord...");

    await interaction.editReply({
      embeds: [progressEmbed],
    });

    await rest.put(Routes.applicationCommands(clientId), {
      body: commands,
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Commands Deployed")
      .setDescription("All slash commands have been registered with Discord")
      .addFields(
        {
          name: "📊 Commands Registered",
          value: commands.length.toString(),
          inline: true,
        },
        {
          name: "🔄 Environment",
          value: isDev ? "Development" : "Production",
          inline: true,
        },
      )
      .setFooter({
        text: "Changes may take a few minutes to appear",
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [successEmbed],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error deploying commands:", errorMsg);
    await interaction.editReply({
      content: `❌ Failed to deploy commands: ${errorMsg}`,
    });
  }
}
