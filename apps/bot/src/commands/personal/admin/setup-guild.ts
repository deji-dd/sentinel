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
  .setName("setup-guild")
  .setDescription("Initialize a guild for the Sentinel bot");

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

    // Get list of all guilds the bot is in
    const allGuilds = client.guilds.cache.map((guild) => ({
      id: guild.id,
      name: guild.name,
    }));

    if (allGuilds.length === 0) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ No Guilds")
        .setDescription("Bot is not a member of any guilds.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Get list of already configured guilds
    const { data: configuredGuilds } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("guild_id");

    const configuredGuildIds = new Set(
      configuredGuilds?.map((config) => config.guild_id) || [],
    );

    // Filter to only uninitialized guilds
    const uninitializedGuilds = allGuilds.filter(
      (guild) => !configuredGuildIds.has(guild.id),
    );

    if (uninitializedGuilds.length === 0) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("⚠️ All Guilds Initialized")
        .setDescription(
          "All guilds the bot is in have already been initialized.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Create select menu for uninitialized guild selection
    const guildOptions = uninitializedGuilds.map((guild) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(guild.name.substring(0, 100))
        .setValue(guild.id)
        .setDescription(`ID: ${guild.id}`),
    );

    const guildSelectMenu = new StringSelectMenuBuilder()
      .setCustomId("setup_guild_select")
      .setPlaceholder("Select a guild to initialize...")
      .addOptions(guildOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      guildSelectMenu,
    );

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Guild Setup")
      .setDescription(
        "Select a guild to initialize. You can then enable modules for that guild.",
      )
      .setFooter({
        text: `${uninitializedGuilds.length} uninitialized guild(s) available`,
      });

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in setup-guild command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Setup Failed")
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

    // Check if guild is already configured
    const { data: existingConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("*")
      .eq("guild_id", selectedGuildId)
      .single();

    if (existingConfig) {
      // Guild already configured, show current modules
      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Guild Already Configured")
        .setDescription(`Guild **${selectedGuildId}** is already initialized.`)
        .addFields({
          name: "Enabled Modules",
          value:
            existingConfig.enabled_modules.length > 0
              ? existingConfig.enabled_modules.join(", ")
              : "None",
        });

      await interaction.editReply({
        embeds: [embed],
        components: [],
      });
      return;
    }

    // Initialize new guild with empty modules
    const { error: insertError } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .insert({
        guild_id: selectedGuildId,
        enabled_modules: [],
        admin_role_ids: [],
        verified_role_ids: [],
      });

    if (insertError) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Initialization Failed")
        .setDescription(insertError.message);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Initialize sync job for this guild
    const { error: syncJobError } = await supabase
      .from(TABLE_NAMES.GUILD_SYNC_JOBS)
      .insert({
        guild_id: selectedGuildId,
        next_sync_at: new Date().toISOString(),
      });

    if (syncJobError) {
      console.error(
        `Warning: Failed to create sync job for guild ${selectedGuildId}:`,
        syncJobError.message,
      );
      // Don't fail the entire setup, just log the warning
    }

    // Show module selection - only general modules, admin is auto-included
    const availableModules = [
      { name: "Verification", value: "verify" },
      // Add more general modules as they're created
    ];

    const moduleOptions = availableModules.map((module) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(module.name)
        .setValue(module.value),
    );

    const moduleSelectMenu = new StringSelectMenuBuilder()
      .setCustomId(`setup_modules_select|${selectedGuildId}`)
      .setPlaceholder("Select modules to enable (optional)...")
      .setMinValues(0)
      .setMaxValues(availableModules.length)
      .addOptions(moduleOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      moduleSelectMenu,
    );

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Guild Initialized")
      .setDescription(
        `Guild **${selectedGuildId}** has been initialized.\n\nNow select which modules to enable:`,
      );

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

export async function handleModulesSelect(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const customIdParts = interaction.customId.split("|");
    const guildId = customIdParts[1];
    const selectedModules = interaction.values;

    // Always include admin module for all guilds
    const modulesToEnable = ["admin", ...selectedModules];

    // Update guild config with selected modules
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

    // Automatically deploy commands to the guild
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
        .setTitle("✅ Guild Setup Complete (Deployment Skipped)")
        .setDescription(`Guild **${guildId}** has been configured.`)
        .addFields({
          name: "Enabled Modules",
          value:
            modulesToEnable.length > 1
              ? modulesToEnable.join(", ")
              : "admin (config only)",
        })
        .setFooter({
          text: "Note: Commands missing bot credentials",
        });

      await interaction.editReply({
        embeds: [warningEmbed],
        components: [],
      });
      return;
    }

    // Deploy commands to the guild
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

    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("✅ Guild Setup Complete")
        .setDescription(`Guild **${guildId}** has been configured.`)
        .addFields({
          name: "Enabled Modules",
          value:
            modulesToEnable.length > 1
              ? modulesToEnable.join(", ")
              : "admin (config only)",
        })
        .addFields({
          name: "Commands Deployed",
          value: `${commands.length} command(s) registered to the guild`,
        })
        .setFooter({
          text: `Check /guild-status for overview`,
        });

      await interaction.editReply({
        embeds: [embed],
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
        .setTitle("✅ Guild Setup Complete (Deployment Partial)")
        .setDescription(`Guild **${guildId}** has been configured.`)
        .addFields({
          name: "Enabled Modules",
          value:
            modulesToEnable.length > 1
              ? modulesToEnable.join(", ")
              : "admin (config only)",
        })
        .addFields({
          name: "Deployment Issue",
          value: deployErrorMsg,
        })
        .setFooter({
          text: "Use /deploy-commands to retry deployment",
        });

      await interaction.editReply({
        embeds: [warningEmbed],
        components: [],
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in modules select handler:", errorMsg);
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
