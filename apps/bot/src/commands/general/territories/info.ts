/**
 * Territory Info Command
 * Query information about a specific territory
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";

export const data = new SlashCommandBuilder()
  .setName("territory")
  .setDescription("Query territory information")
  .addSubcommand((sub) =>
    sub
      .setName("info")
      .setDescription("Get information about a specific territory")
      .addStringOption((opt) =>
        opt
          .setName("id")
          .setDescription("Territory ID or code (e.g., LSG)")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("wars")
      .setDescription("List active territory wars")
      .addNumberOption((opt) =>
        opt
          .setName("limit")
          .setDescription("Maximum number of wars to show (default: 10)")
          .setMinValue(1)
          .setMaxValue(50),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("config")
      .setDescription("Configure TT notifications for this guild"),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.editReply({
        content: "This command can only be used in a guild.",
      });
      return;
    }

    switch (subcommand) {
      case "info":
        await handleTerritoryInfo(interaction, supabase, guildId);
        break;
      case "wars":
        await handleTerritoryWars(interaction, supabase);
        break;
      case "config":
        await handleTTConfig(interaction, supabase, guildId);
        break;
    }
  } catch (error) {
    console.error("[Territory Command] Error:", error);

    await interaction.editReply({
      content: "An error occurred while processing your request.",
    });
  }
}

async function handleTerritoryInfo(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
  _guildId: string,
): Promise<void> {
  const territoryId = interaction.options.getString("id", true).toUpperCase();

  // Fetch territory blueprint (geography)
  const { data: blueprint } = await supabase
    .from(TABLE_NAMES.TERRITORY_BLUEPRINT)
    .select("*")
    .eq("id", territoryId)
    .single();

  if (!blueprint) {
    await interaction.editReply({
      content: `Territory **${territoryId}** not found.`,
    });
    return;
  }

  // Fetch territory state (ownership)
  const { data: state } = await supabase
    .from(TABLE_NAMES.TERRITORY_STATE)
    .select("faction_id, is_warring, updated_at")
    .eq("territory_id", territoryId)
    .single();

  // If there's an active war, fetch war details
  let warInfo = null;
  if (state?.is_warring) {
    const { data: war } = await supabase
      .from(TABLE_NAMES.WAR_LEDGER)
      .select("*")
      .eq("territory_id", territoryId)
      .is("end_time", null)
      .single();
    warInfo = war;
  }

  // Build the response embed
  const embed = new EmbedBuilder()
    .setTitle(`Territory: ${territoryId}`)
    .setColor(0x0099ff);

  // Geography info
  embed.addFields({
    name: "Location",
    value: `Sector: **${blueprint.sector}** | Coordinates: (**${blueprint.coordinate_x}**, **${blueprint.coordinate_y}**)`,
  });

  embed.addFields({
    name: "Details",
    value: `Size: **${blueprint.size}** | Density: **${blueprint.density}** | Slots: **${blueprint.slots}**`,
  });

  embed.addFields({
    name: "Respect",
    value: `**${blueprint.respect}** per assault`,
  });

  // Ownership info
  const ownershipStatus =
    state && state.faction_id
      ? `Owned by Faction **${state.faction_id}**`
      : "Uncontrolled";
  embed.addFields({ name: "Status", value: ownershipStatus });

  // War info if active
  if (warInfo) {
    embed.addFields({
      name: "⚔️ Active War",
      value: `Assaulting: **${warInfo.assaulting_faction}** vs Defending: **${warInfo.defending_faction}**`,
    });
  }

  embed.setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleTerritoryWars(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  const limit = interaction.options.getNumber("limit") ?? 10;

  // Fetch active wars
  const { data: wars } = await supabase
    .from(TABLE_NAMES.WAR_LEDGER)
    .select("*")
    .is("end_time", null)
    .limit(limit);

  if (!wars || wars.length === 0) {
    await interaction.editReply({
      content: "No active territory wars at the moment.",
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Active Territory Wars (${wars.length})`)
    .setColor(0xff0000);

  for (const war of wars) {
    embed.addFields({
      name: `${war.territory_id}`,
      value: `🎯 **${war.assaulting_faction}** → Defending: **${war.defending_faction}**`,
      inline: true,
    });
  }

  embed.setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleTTConfig(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
  guildId: string,
): Promise<void> {
  // Check if user is admin or has required role
  const userId = interaction.user.id;
  const member = await interaction.guild?.members.fetch(userId);
  const isAdmin =
    member?.permissions.has("ManageGuild") ||
    userId === process.env.OWNER_ID;

  if (!isAdmin) {
    await interaction.editReply({
      content: "You need **Manage Guild** permission to configure TT notifications.",
    });
    return;
  }

  // Fetch current config
  const { data: currentConfig } = await supabase
    .from(TABLE_NAMES.TT_CONFIG)
    .select("*")
    .eq("guild_id", guildId)
    .single();

  const embed = new EmbedBuilder()
    .setTitle("TT Module Configuration")
    .setColor(0x0099ff);

  if (!currentConfig) {
    embed.setDescription(
      "No TT configuration found. Use the config menu to set up notifications.",
    );
  } else {
    embed.addFields({
      name: "Notification Type",
      value: `**${currentConfig.notification_type}**`,
    });

    if (currentConfig.territory_ids?.length > 0) {
      embed.addFields({
        name: "Monitored Territories",
        value: currentConfig.territory_ids.slice(0, 10).join(", "),
        inline: true,
      });
    }

    if (currentConfig.faction_ids?.length > 0) {
      embed.addFields({
        name: "Monitored Factions",
        value: currentConfig.faction_ids.slice(0, 10).join(", "),
        inline: true,
      });
    }
  }

  embed.setDescription(
    "**Notification Types:**\n" +
      "• `all` - Notify on all TT changes\n" +
      "• `territories` - Notify on changes to specific territories\n" +
      "• `factions` - Notify on wars involving specific factions\n" +
      "• `combined` - Notify if territory OR faction matches",
  );

  embed.setFooter({
    text: "Use /config to set up TT notifications. Ensure bot has log channel set.",
  });

  embed.setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
