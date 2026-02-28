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

import { TABLE_NAMES } from "@sentinel/shared";
import { supabase } from "../../../lib/supabase.js";

export const data = new SlashCommandBuilder()
  .setName("remove-module")
  .setDescription(
    "Remove modules from a configured guild without tearing it down",
  );

export async function execute(
  interaction: ChatInputCommandInteraction,

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

    // Get list of all configured guilds with modules
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

    // Filter to only guilds with modules that can be removed (not just admin)
    const guildsWithRemovableModules = configuredGuilds.filter((config) => {
      const removableModules = (config.enabled_modules as string[]).filter(
        (m) => m !== "admin",
      );
      return removableModules.length > 0;
    });

    if (guildsWithRemovableModules.length === 0) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("⚠️ No Removable Modules")
        .setDescription(
          "No guilds have modules that can be removed (all are admin-only).",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Create select menu for guild selection
    const guildOptions = guildsWithRemovableModules.map((config) => {
      const guild = client.guilds.cache.get(config.guild_id);
      const guildName = guild?.name || `Unknown Guild (${config.guild_id})`;
      const modulesList = (config.enabled_modules as string[])
        .filter((m) => m !== "admin")
        .join(", ");

      return new StringSelectMenuOptionBuilder()
        .setLabel(guildName.substring(0, 100))
        .setValue(config.guild_id)
        .setDescription(`Current: ${modulesList}`);
    });

    const guildSelectMenu = new StringSelectMenuBuilder()
      .setCustomId("remove_module_guild_select")
      .setPlaceholder("Select a guild...")
      .addOptions(guildOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      guildSelectMenu,
    );

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Module Removal")
      .setDescription(
        "Select a guild to remove modules from. This will keep the guild initialized.",
      );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in remove-module command:", errorMsg);
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

    // Available modules for removal (exclude admin)
    const removableModules = (guildConfig.enabled_modules as string[])
      .filter((m) => m !== "admin")
      .map((moduleName) => ({
        name:
          moduleName.charAt(0).toUpperCase() +
          moduleName.slice(1).toLowerCase(),
        value: moduleName,
      }));

    if (removableModules.length === 0) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("⚠️ No Removable Modules")
        .setDescription(
          `Guild **${selectedGuildId}** only has the admin module enabled.`,
        );

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    const moduleOptions = removableModules.map((module) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(module.name)
        .setValue(module.value)
        .setDescription(`Click to remove`),
    );

    const moduleSelectMenu = new StringSelectMenuBuilder()
      .setCustomId(`remove_module_select|${selectedGuildId}`)
      .setPlaceholder("Select modules to remove...")
      .setMinValues(1)
      .setMaxValues(removableModules.length)
      .addOptions(moduleOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      moduleSelectMenu,
    );

    const currentModules = removableModules.map((m) => m.name).join(", ");

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Module Removal")
      .setDescription(
        `Guild: **${selectedGuildId}**\nCurrent modules: **${currentModules}**\n\nSelect modules to remove:`,
      )
      .setFooter({
        text: "Note: Admin module is always kept",
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

export async function handleModuleRemove(
  interaction: StringSelectMenuInteraction,

  client: Client,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const customIdParts = interaction.customId.split("|");
    const guildId = customIdParts[1];
    const guildName = client.guilds.cache.get(guildId)?.name ?? guildId;
    const modulesToRemove = interaction.values;

    // Get current modules
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("enabled_modules")
      .eq("guild_id", guildId)
      .single();

    if (!guildConfig) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription(`Guild ${guildId} not found.`);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Keep admin and other non-removed modules
    const modulesToEnable = (guildConfig.enabled_modules as string[]).filter(
      (m) => m === "admin" || !modulesToRemove.includes(m),
    );

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
        .setTitle("❌ Failed to Remove Modules")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Deploy updated commands to this guild
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
        .setTitle("⚠️ Modules Removed (Deployment Failed)")
        .setDescription(
          `Guild **${guildName}** modules have been removed, but command deployment failed due to missing credentials.`,
        )
        .addFields({
          name: "Removed Modules",
          value: modulesToRemove.join(", "),
        })
        .addFields({
          name: "Remaining Modules",
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

    // Deploy commands to this guild
    const { REST, Routes } = await import("discord.js");
    const rest = new REST({ version: "10" }).setToken(token);

    const commands = [];

    // Load config command (always deployed)
    const configCommand = await import("../../general/admin/config.js");
    commands.push(configCommand.data.toJSON());

    // Conditionally load modules based on what's remaining
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
        .setTitle("✅ Modules Removed & Commands Updated")
        .setDescription(`Guild **${guildName}** has been updated.`)
        .addFields({
          name: "Removed Modules",
          value: modulesToRemove.join(", "),
        })
        .addFields({
          name: "Remaining Modules",
          value:
            modulesToEnable.length > 1
              ? modulesToEnable.join(", ")
              : "admin (config only)",
        })
        .addFields({
          name: "Commands Deployed",
          value: `${commands.length} command(s) registered to the guild`,
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
        .setTitle("⚠️ Modules Removed (Deployment Partial)")
        .setDescription(`Guild **${guildName}** modules have been removed.`)
        .addFields({
          name: "Removed Modules",
          value: modulesToRemove.join(", "),
        })
        .addFields({
          name: "Remaining Modules",
          value:
            modulesToEnable.length > 1
              ? modulesToEnable.join(", ")
              : "admin (config only)",
        })
        .addFields({
          name: "Deployment Issue",
          value: deployErrorMsg,
        });

      await interaction.editReply({
        embeds: [warningEmbed],
        components: [],
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in module remove handler:", errorMsg);
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
