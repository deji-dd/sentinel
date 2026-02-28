import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type Client,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";

export const data = new SlashCommandBuilder()
  .setName("enable-module")
  .setDescription("Enable or disable modules for a configured guild");

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
  client: Client,
): Promise<void> {
  try {
    await interaction.deferReply();

    const adminGuildId = process.env.ADMIN_GUILD_ID;

    // Check if command is being run in admin guild
    if (!interaction.guild || interaction.guild.id !== adminGuildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Admin Only")
        .setDescription(
          "This command can only be run in the admin guild. Contact the bot owner.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Get list of all configured guilds
    const { data: configuredGuilds } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("guild_id, enabled_modules");

    if (!configuredGuilds || configuredGuilds.length === 0) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("⚠️ No Configured Guilds")
        .setDescription(
          "No guilds have been initialized yet. Use /setup-guild first.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Create select menu for guild selection
    const guildOptions = configuredGuilds.map((config) => {
      const guild = client.guilds.cache.get(config.guild_id);
      const guildName = guild?.name || `Unknown Guild (${config.guild_id})`;
      const modulesList =
        config.enabled_modules
          .filter((m: string) => m !== "admin")
          .join(", ") || "none";

      return new StringSelectMenuOptionBuilder()
        .setLabel(guildName.substring(0, 100))
        .setValue(config.guild_id)
        .setDescription(`Current: ${modulesList}`);
    });

    const guildSelectMenu = new StringSelectMenuBuilder()
      .setCustomId("enable_module_guild_select")
      .setPlaceholder("Select a guild...")
      .addOptions(guildOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      guildSelectMenu,
    );

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Module Management")
      .setDescription("Select a guild to manage its modules.");

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in enable-module command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}

export async function handleGuildSelect(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const selectedGuildId = interaction.values[0];

    // Get current config for this guild
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("enabled_modules")
      .eq("guild_id", selectedGuildId)
      .single();

    if (!guildConfig) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Guild Not Found")
        .setDescription(`Guild ${selectedGuildId} is not configured.`);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Available modules for toggling
    const allModules = [
      { name: "Verify", value: "verify" },
      { name: "Territories", value: "territories" },
    ];

    const moduleOptions = allModules.map((module) => {
      const isEnabled = guildConfig.enabled_modules.includes(module.value);
      return new StringSelectMenuOptionBuilder()
        .setLabel(`${isEnabled ? "✅ " : "❌ "} ${module.name}`)
        .setValue(module.value)
        .setDescription(isEnabled ? "Currently enabled" : "Currently disabled");
    });

    const moduleSelectMenu = new StringSelectMenuBuilder()
      .setCustomId(`enable_module_toggle|${selectedGuildId}`)
      .setPlaceholder("Click to toggle modules...")
      .setMinValues(0)
      .setMaxValues(allModules.length)
      .addOptions(moduleOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      moduleSelectMenu,
    );

    const currentModules =
      guildConfig.enabled_modules
        .filter((m: string) => m !== "admin")
        .join(", ") || "none";

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Module Selection")
      .setDescription(
        `Guild: **${selectedGuildId}**\nCurrent modules: **${currentModules}**\n\nSelect modules to enable or disable:`,
      )
      .setFooter({
        text: "Note: Admin module is always enabled",
      });

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in guild select handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
      components: [],
    });
  }
}

export async function handleModuleToggle(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
  client: Client,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const customIdParts = interaction.customId.split("|");
    const guildId = customIdParts[1];
    const guildName = client.guilds.cache.get(guildId)?.name ?? guildId;
    const selectedModules = interaction.values;

    // Always include admin module
    const modulesToEnable = ["admin", ...selectedModules];

    // Update guild config
    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({
        enabled_modules: modulesToEnable,
      })
      .eq("guild_id", guildId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Failed to Update Modules")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Deploy commands to this guild
    const isDev = process.env.NODE_ENV === "development";
    const token = isDev
      ? process.env.DISCORD_BOT_TOKEN_LOCAL
      : process.env.DISCORD_BOT_TOKEN;
    const clientId = isDev
      ? process.env.DISCORD_CLIENT_ID_LOCAL
      : process.env.DISCORD_CLIENT_ID;

    if (!token || !clientId) {
      const warningEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("⚠️ Modules Updated (Deployment Failed)")
        .setDescription(
          `Guild **${guildName}** modules have been updated, but command deployment failed due to missing credentials.`,
        )
        .addFields({
          name: "Enabled Modules",
          value:
            modulesToEnable.length > 1
              ? modulesToEnable.join(", ")
              : "admin (config only)",
        });

      await interaction.editReply({
        embeds: [warningEmbed],
        components: [],
      });
      return;
    }

    // Dynamically deploy commands based on enabled modules
    const { REST, Routes } = await import("discord.js");
    const rest = new REST({ version: "10" }).setToken(token);

    const commands = [];

    // Load config command (always deployed)
    const configCommand = await import("../../general/admin/config.js");
    commands.push(configCommand.data.toJSON());

    // Conditionally load modules
    if (modulesToEnable.includes("verify")) {
      const verifyCommand =
        await import("../../general/verification/verify.js");
      const verifyallCommand =
        await import("../../general/verification/verifyall.js");
      commands.push(verifyCommand.data.toJSON());
      commands.push(verifyallCommand.data.toJSON());
    }

    if (modulesToEnable.includes("territories")) {
      const assaultCheckCommand =
        await import("../../general/territories/assault-check.js");
      const burnMapCommand =
        await import("../../general/territories/burn-map.js");
      const burnMapSimulatorCommand =
        await import("../../general/territories/burn-map-simulator.js");
      commands.push(assaultCheckCommand.data.toJSON());
      commands.push(burnMapCommand.data.toJSON());
      commands.push(burnMapSimulatorCommand.data.toJSON());
    }

    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });

      const successEmbed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("✅ Modules Updated & Deployed")
        .setDescription(`Guild **${guildName}** has been updated.`)
        .addFields({
          name: "Enabled Modules",
          value:
            modulesToEnable.length > 1
              ? modulesToEnable.join(", ")
              : "admin (config only)",
        });

      await interaction.editReply({
        embeds: [successEmbed],
        components: [],
      });
    } catch (deployError) {
      const deployErrorMsg =
        deployError instanceof Error
          ? deployError.message
          : String(deployError);
      console.error(
        `Failed to deploy commands to guild ${guildId}:`,
        deployErrorMsg,
      );

      const warningEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("⚠️ Modules Updated (Deployment Partial)")
        .setDescription(
          `Guild **${guildName}** modules have been updated, but command deployment had issues: ${deployErrorMsg}`,
        );

      await interaction.editReply({
        embeds: [warningEmbed],
        components: [],
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in module toggle handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
      components: [],
    });
  }
}
