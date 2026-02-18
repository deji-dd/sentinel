import { SlashCommandBuilder, EmbedBuilder, REST, Routes } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";

export const data = new SlashCommandBuilder()
  .setName("deploy-commands")
  .setDescription("Deploy commands to your admin guild and configured guilds");

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
  client: Client,
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
    const adminGuildId = process.env.ADMIN_GUILD_ID;

    if (!token || !clientId || !adminGuildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Configuration Error")
        .setDescription("Missing Discord credentials in environment variables");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    const progressEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("⏳ Deploying Commands")
      .setDescription("Registering commands to Discord...");

    await interaction.editReply({
      embeds: [progressEmbed],
    });

    const rest = new REST({ version: "10" }).setToken(token);

    // Load all available commands
    const financeCommand = await import("./finance.js");
    const financeSettingsCommand = await import("./finance-settings.js");
    const forceRunCommand = await import("./force-run.js");
    const deployCommandsCommand = await import("./deploy-commands.js");
    const setupGuildCommand = await import("./setup-guild.js");
    const verifyCommand = await import("../general/verify.js");
    const configCommand = await import("../general/config.js");

    // Map of module names to commands
    const commandsByModule: Record<string, any[]> = {
      finance: [financeCommand.data.toJSON(), financeSettingsCommand.data],
    };

    let successCount = 0;
    let failureCount = 0;
    const deploymentResults: { guild: string; status: "✅" | "❌" }[] = [];

    // Clear global commands first
    try {
      await rest.put(Routes.applicationCommands(clientId), {
        body: [],
      });
    } catch (err) {
      console.error("Failed to clear global commands:", err);
    }

    // Deploy to admin guild (always)
    try {
      const adminCommands = [
        financeCommand.data.toJSON(),
        financeSettingsCommand.data,
        forceRunCommand.data.toJSON(),
        deployCommandsCommand.data.toJSON(),
        setupGuildCommand.data.toJSON(),
        verifyCommand.data.toJSON(),
        configCommand.data.toJSON(),
      ];

      await rest.put(Routes.applicationGuildCommands(clientId, adminGuildId), {
        body: adminCommands,
      });

      successCount++;
      deploymentResults.push({
        guild: `Admin Guild (${adminGuildId})`,
        status: "✅",
      });
    } catch (err) {
      console.error(`Failed to deploy to admin guild ${adminGuildId}:`, err);
      failureCount++;
      deploymentResults.push({
        guild: `Admin Guild (${adminGuildId})`,
        status: "❌",
      });
    }

    // Deploy to configured guilds based on enabled modules
    const { data: guildConfigs } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("*");

    if (guildConfigs && guildConfigs.length > 0) {
      for (const guildConfig of guildConfigs) {
        try {
          const guildId = guildConfig.guild_id;
          const enabledModules: string[] = guildConfig.enabled_modules || [];

          let guildCommands: any[] = [];

          for (const module of enabledModules) {
            if (commandsByModule[module]) {
              guildCommands.push(...commandsByModule[module]);
            }
          }

          if (guildCommands.length === 0) {
            continue;
          }

          await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
            body: guildCommands,
          });

          successCount++;
          deploymentResults.push({ guild: guildId, status: "✅" });
        } catch (err) {
          console.error(
            `Failed to deploy to guild ${guildConfig.guild_id}:`,
            err,
          );
          failureCount++;
          deploymentResults.push({ guild: guildConfig.guild_id, status: "❌" });
        }
      }
    }

    const resultEmbed = new EmbedBuilder()
      .setColor(failureCount === 0 ? 0x22c55e : 0xf59e0b)
      .setTitle("✅ Command Deployment Complete")
      .addFields(
        {
          name: "✅ Successful",
          value: successCount.toString(),
          inline: true,
        },
        {
          name: "❌ Failed",
          value: failureCount.toString(),
          inline: true,
        },
        {
          name: "🌍 Deployments",
          value:
            deploymentResults.length > 0
              ? deploymentResults
                  .map((r) => `${r.status} ${r.guild}`)
                  .join("\n")
              : "None",
        },
      )
      .setFooter({
        text: "Changes may take a few minutes to appear in Discord",
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [resultEmbed],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error deploying commands:", errorMsg);

    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Deployment Failed")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
