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

    // Get list of guilds the bot is in
    const guilds = client.guilds.cache.map((guild) => ({
      id: guild.id,
      name: guild.name,
    }));

    if (guilds.length === 0) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ No Guilds")
        .setDescription("Bot is not a member of any guilds.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Create select menu for guild selection
    const guildOptions = guilds.map((guild) =>
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
        text: `${guilds.length} guild(s) available`,
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

    // Show module selection
    const availableModules = [
      { name: "Finance", value: "finance" },
      { name: "Search", value: "search" },
      // Add more modules as they're created
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

    // Update guild config with selected modules
    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({
        enabled_modules: selectedModules,
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

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Guild Setup Complete")
      .setDescription(`Guild **${guildId}** has been configured.`)
      .addFields({
        name: "Enabled Modules",
        value:
          selectedModules.length > 0
            ? selectedModules.join(", ")
            : "None (you can update this later)",
      });

    await interaction.editReply({
      embeds: [embed],
      components: [],
    });
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
