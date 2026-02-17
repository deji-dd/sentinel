import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";

export const data = new SlashCommandBuilder()
  .setName("settings-build")
  .setDescription("Set your preferred stat build strategy and main stat focus");

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply();

    // Fetch current preference
    const { data: currentPref } = await supabase
      .from(TABLE_NAMES.STAT_BUILD_PREFERENCES)
      .select(
        `
        build_id, main_stat,
        build: ${TABLE_NAMES.STAT_BUILDS}(name, slug)
      `,
      )
      .limit(1)
      .single();

    // Fetch all builds for selection
    const { data: buildsData } = await supabase
      .from(TABLE_NAMES.STAT_BUILDS)
      .select("id, name, slug")
      .order("name");

    const builds = (buildsData || []) as Array<{
      id: string;
      name: string;
      slug: string;
    }>;

    if (builds.length === 0) {
      await interaction.editReply({
        content: "❌ No stat builds available in the database.",
      });
      return;
    }

    // Create select menu for builds
    const buildSelectRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("build_select_menu")
          .setPlaceholder("Select a build strategy")
          .addOptions(
            builds.map((build) => ({
              label: build.name,
              value: build.id,
              description: `Choose ${build.name}`,
              default: currentPref?.build_id === build.id,
            })),
          ),
      );

    // Create embed showing current preference
    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("⚙️ Stat Build Preferences")
      .setDescription("Select your preferred stat build strategy");

    if (currentPref) {
      const buildName =
        typeof currentPref.build === "object" &&
        currentPref.build !== null &&
        !Array.isArray(currentPref.build)
          ? (currentPref.build as { name: string }).name
          : "Unknown";
      embed.addFields({
        name: "📌 Current Selection",
        value: `**Build:** ${buildName}\n**Main Stat:** ${currentPref.main_stat.toUpperCase()}`,
        inline: false,
      });
    } else {
      embed.addFields({
        name: "📌 Current Selection",
        value: "None set yet",
        inline: false,
      });
    }

    embed.addFields({
      name: "ℹ️ What this does",
      value:
        "Your selected build strategy influences training recommendations to help you progress towards your chosen stat focus.",
      inline: false,
    });

    await interaction.editReply({
      embeds: [embed],
      components: [buildSelectRow],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in settings-build command:", errorMsg);
    await interaction.editReply({
      content: `❌ Failed to load build settings: ${errorMsg}`,
    });
  }
}

export async function handleBuildSelectMenu(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply();

    const selectedBuildId = interaction.values[0];

    // Fetch the selected build to get its configurations
    const { data: buildData, error: buildError } = await supabase
      .from(TABLE_NAMES.STAT_BUILDS)
      .select(
        "id, name, configurations: " +
          TABLE_NAMES.STAT_BUILD_CONFIGURATIONS +
          "(main_stat)",
      )
      .eq("id", selectedBuildId)
      .single();

    if (buildError || !buildData) {
      await interaction.editReply({
        content: "❌ Failed to load build configurations.",
      });
      return;
    }

    type BuildWithConfigs = {
      id: string;
      name: string;
      configurations: Array<{ main_stat: string }>;
    };

    const build = buildData as unknown as BuildWithConfigs;

    const configs = build.configurations || [];
    if (configs.length === 0) {
      await interaction.editReply({
        content: "❌ No configurations available for this build.",
      });
      return;
    }

    // Get current preference to see if main_stat is already set for this build
    const { data: currentPref } = await supabase
      .from(TABLE_NAMES.STAT_BUILD_PREFERENCES)
      .select("build_id, main_stat")
      .limit(1)
      .single();

    const defaultMainStat =
      currentPref?.build_id === selectedBuildId
        ? currentPref.main_stat
        : configs[0].main_stat;

    // Create stat select menu with build ID encoded in customId
    const statSelectRowWithBuildId =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`main_stat_select_menu|${selectedBuildId}`)
          .setPlaceholder("Select main stat focus")
          .addOptions(
            configs.map((config) => ({
              label: config.main_stat.toUpperCase(),
              value: config.main_stat,
              description: `Focus on ${config.main_stat}`,
              default: defaultMainStat === config.main_stat,
            })),
          ),
      );

    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle(`📊 ${build.name} - Select Main Stat`)
      .setDescription("Choose which stat to focus on for this build");

    await interaction.editReply({
      embeds: [embed],
      components: [statSelectRowWithBuildId],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in build select menu:", errorMsg);
    await interaction.editReply({
      content: `❌ Failed to process selection: ${errorMsg}`,
    });
  }
}

export async function handleStatSelectMenu(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
  buildId: string,
): Promise<void> {
  try {
    await interaction.deferReply();

    if (!buildId) {
      await interaction.editReply({
        content:
          "❌ Build ID is missing. Please try selecting your build again.",
      });
      return;
    }

    const mainStat = interaction.values[0];

    // For single-user app, fetch existing preference to update, or insert new
    const { data: existingPref } = await supabase
      .from(TABLE_NAMES.STAT_BUILD_PREFERENCES)
      .select("id")
      .limit(1)
      .single();

    let upsertError;

    if (existingPref) {
      // Update existing preference
      const { error } = await supabase
        .from(TABLE_NAMES.STAT_BUILD_PREFERENCES)
        .update({
          build_id: buildId,
          main_stat: mainStat,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingPref.id);
      upsertError = error;
    } else {
      // Insert new preference
      const { error } = await supabase
        .from(TABLE_NAMES.STAT_BUILD_PREFERENCES)
        .insert({
          build_id: buildId,
          main_stat: mainStat,
        });
      upsertError = error;
    }

    if (upsertError) {
      await interaction.editReply({
        content: `❌ Failed to save preferences: ${upsertError.message}`,
      });
      return;
    }

    // Fetch build name for confirmation
    const { data: buildData } = await supabase
      .from(TABLE_NAMES.STAT_BUILDS)
      .select("name")
      .eq("id", buildId)
      .single();

    const build = buildData as { name: string } | null;

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Build Preference Saved")
      .addFields(
        {
          name: "📊 Build Strategy",
          value: build?.name || "Unknown",
          inline: true,
        },
        {
          name: "🎯 Main Stat Focus",
          value: mainStat.toUpperCase(),
          inline: true,
        },
      )
      .setDescription(
        "Your training recommendations will now prioritize this configuration.",
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in stat select menu:", errorMsg);
    await interaction.editReply({
      content: `❌ Failed to save preferences: ${errorMsg}`,
    });
  }
}
