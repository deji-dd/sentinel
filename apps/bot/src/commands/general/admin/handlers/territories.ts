/**
 * Territory (TT) module settings handlers
 * Manages TT notifications, territory filters, and faction filters
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES, getFactionDataBatchCached } from "@sentinel/shared";
import { decrypt } from "../../../../lib/encryption.js";
import { botTornApi } from "../../../../lib/torn-api.js";

interface TTConfig {
  guild_id: string;
  tt_full_channel_id: string | null;
  tt_filtered_channel_id: string | null;
  tt_territory_ids: string[];
  tt_faction_ids: number[];
}

interface ApiKeyEntry {
  key: string; // encrypted
  fingerprint: string;
  isActive: boolean;
  createdAt: string;
}

async function getTTConfig(
  supabase: SupabaseClient,
  guildId: string,
): Promise<TTConfig> {
  const { data: ttConfig } = await supabase
    .from(TABLE_NAMES.GUILD_CONFIG)
    .select(
      "guild_id, tt_full_channel_id, tt_filtered_channel_id, tt_territory_ids, tt_faction_ids",
    )
    .eq("guild_id", guildId)
    .single();

  return (
    ttConfig || {
      guild_id: guildId,
      tt_full_channel_id: null,
      tt_filtered_channel_id: null,
      tt_territory_ids: [],
      tt_faction_ids: [],
    }
  );
}

async function upsertTTConfig(
  supabase: SupabaseClient,
  guildId: string,
  updates: Partial<TTConfig>,
): Promise<void> {
  await supabase.from(TABLE_NAMES.GUILD_CONFIG).upsert(
    {
      guild_id: guildId,
      ...updates,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "guild_id" },
  );
}

async function getActiveApiKey(
  supabase: SupabaseClient,
  guildId: string,
): Promise<string | null> {
  const { data: guildConfig } = await supabase
    .from(TABLE_NAMES.GUILD_CONFIG)
    .select("api_keys")
    .eq("guild_id", guildId)
    .single();

  const apiKeys: ApiKeyEntry[] = guildConfig?.api_keys || [];
  const activeKey = apiKeys.find((key) => key.isActive);
  if (!activeKey) {
    return null;
  }

  try {
    return decrypt(activeKey.key);
  } catch (error) {
    console.warn("Failed to decrypt API key for TT settings:", error);
    return null;
  }
}

async function getFactionNameMap(
  supabase: SupabaseClient,
  factionIds: number[],
  apiKey: string | null,
): Promise<Map<number, string>> {
  const nameMap = new Map<number, string>();
  if (factionIds.length === 0) {
    return nameMap;
  }

  const { data: cached } = await supabase
    .from(TABLE_NAMES.TORN_FACTIONS)
    .select("id, name")
    .in("id", factionIds);

  if (cached) {
    for (const faction of cached) {
      nameMap.set(faction.id, faction.name);
    }
  }

  if (!apiKey) {
    return nameMap;
  }

  const missingIds = factionIds.filter((id) => !nameMap.has(id));
  if (missingIds.length === 0) {
    return nameMap;
  }

  const fetched = await getFactionDataBatchCached(
    supabase,
    missingIds,
    botTornApi,
    apiKey,
  );

  for (const [id, data] of fetched.entries()) {
    nameMap.set(id, data.name);
  }

  return nameMap;
}

function formatChannel(channelId: string | null | undefined): string {
  return channelId ? `<#${channelId}>` : "Disabled (no channel set)";
}

export async function handleShowTTSettings(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getTTConfig(supabase, guildId);
    const apiKey = await getActiveApiKey(supabase, guildId);
    const factionNameMap = await getFactionNameMap(
      supabase,
      config.tt_faction_ids,
      apiKey,
    );

    const factionDisplay =
      config.tt_faction_ids.length > 0
        ? config.tt_faction_ids
            .map((id) => `${factionNameMap.get(id) || `Faction ${id}`} (${id})`)
            .join(", ")
        : "None";

    const hasFilteredFilters =
      config.tt_territory_ids.length > 0 || config.tt_faction_ids.length > 0;
    const filteredStatus = !config.tt_filtered_channel_id
      ? "Disabled (no channel set)"
      : hasFilteredFilters
        ? `<#${config.tt_filtered_channel_id}>`
        : `Disabled (no filters set, channel <#${config.tt_filtered_channel_id}>)`;

    const ttEmbed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("Territories Settings")
      .addFields(
        {
          name: "Full Notifications",
          value: formatChannel(config.tt_full_channel_id),
          inline: false,
        },
        {
          name: "Filtered Notifications",
          value: filteredStatus,
          inline: false,
        },
        {
          name: "Filtered Territories",
          value:
            config.tt_territory_ids.length > 0
              ? config.tt_territory_ids.join(", ")
              : "None",
          inline: false,
        },
        {
          name: "Filtered Factions",
          value: factionDisplay,
          inline: false,
        },
      );

    const settingOptions = [
      new StringSelectMenuOptionBuilder()
        .setLabel("Full Notifications")
        .setValue("tt_full")
        .setDescription("All territory changes to one channel"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Filtered Notifications")
        .setValue("tt_filtered")
        .setDescription("Only selected territories/factions"),
    ];

    const settingsMenu = new StringSelectMenuBuilder()
      .setCustomId("tt_settings_edit")
      .setPlaceholder("Select setting to edit...")
      .addOptions(settingOptions);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_to_menu")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const menuRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        settingsMenu,
      );

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      backBtn,
    );

    await interaction.editReply({
      embeds: [ttEmbed],
      components: [menuRow, buttonRow],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error showing TT settings:", errorMsg);
  }
}

export async function handleTTSettingsEdit(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    const selectedSetting = interaction.values[0];

    if (selectedSetting === "tt_full") {
      await showFullTTSettings(interaction, supabase);
    } else if (selectedSetting === "tt_filtered") {
      await showFilteredTTSettings(interaction, supabase);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in TT settings edit:", errorMsg);
  }
}

async function showFullTTSettings(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  const guildId = interaction.guildId;
  if (!guildId) return;

  const config = await getTTConfig(supabase, guildId);

  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("Full Territory Notifications")
    .setDescription(
      "Send every territory change notification to a single channel.",
    )
    .addFields({
      name: "Channel",
      value: formatChannel(config.tt_full_channel_id),
      inline: false,
    });

  const channelSelectMenu = new ChannelSelectMenuBuilder()
    .setCustomId("tt_full_channel_select")
    .setPlaceholder("Select a channel for full notifications")
    .addChannelTypes(ChannelType.GuildText);

  const disableBtn = new ButtonBuilder()
    .setCustomId("tt_full_channel_clear")
    .setLabel("Disable")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!config.tt_full_channel_id);

  const backBtn = new ButtonBuilder()
    .setCustomId("tt_settings_show")
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const menuRow =
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      channelSelectMenu,
    );
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    disableBtn,
    backBtn,
  );

  await interaction.editReply({
    embeds: [embed],
    components: [menuRow, buttonRow],
  });
}

async function showFilteredTTSettings(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  const guildId = interaction.guildId;
  if (!guildId) return;

  const config = await getTTConfig(supabase, guildId);
  const apiKey = await getActiveApiKey(supabase, guildId);
  const factionNameMap = await getFactionNameMap(
    supabase,
    config.tt_faction_ids,
    apiKey,
  );

  const territoryDisplay =
    config.tt_territory_ids.length > 0
      ? config.tt_territory_ids.join(", ")
      : "None";
  const factionDisplay =
    config.tt_faction_ids.length > 0
      ? config.tt_faction_ids
          .map((id) => `${factionNameMap.get(id) || `Faction ${id}`} (${id})`)
          .join(", ")
      : "None";

  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("Filtered Territory Notifications")
    .setDescription(
      "Send territory change notifications that match selected territories or factions.",
    )
    .addFields(
      {
        name: "Channel",
        value: formatChannel(config.tt_filtered_channel_id),
        inline: false,
      },
      {
        name: "Status",
        value:
          config.tt_filtered_channel_id &&
          (config.tt_territory_ids.length > 0 ||
            config.tt_faction_ids.length > 0)
            ? "Enabled"
            : "Disabled (requires channel + filters)",
        inline: false,
      },
      {
        name: "Territories",
        value: territoryDisplay,
        inline: false,
      },
      {
        name: "Factions",
        value: factionDisplay,
        inline: false,
      },
    );

  const channelSelectMenu = new ChannelSelectMenuBuilder()
    .setCustomId("tt_filtered_channel_select")
    .setPlaceholder("Select a channel for filtered notifications")
    .addChannelTypes(ChannelType.GuildText);

  const filterMenu = new StringSelectMenuBuilder()
    .setCustomId("tt_filtered_settings_edit")
    .setPlaceholder("Select filters to edit...")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Edit Territory Filters")
        .setValue("tt_edit_territories")
        .setDescription("Specify which territories to monitor"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Edit Faction Filters")
        .setValue("tt_edit_factions")
        .setDescription("Specify which factions to monitor"),
    );

  const disableBtn = new ButtonBuilder()
    .setCustomId("tt_filtered_channel_clear")
    .setLabel("Disable")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!config.tt_filtered_channel_id);

  const backBtn = new ButtonBuilder()
    .setCustomId("tt_settings_show")
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const channelRow =
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      channelSelectMenu,
    );
  const filterRow =
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(filterMenu);
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    disableBtn,
    backBtn,
  );

  await interaction.editReply({
    embeds: [embed],
    components: [channelRow, filterRow, buttonRow],
  });
}

export async function handleTTFilteredSettingsEdit(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    const selectedSetting = interaction.values[0];

    if (selectedSetting === "tt_edit_territories") {
      const modal = new ModalBuilder()
        .setCustomId("tt_edit_territories_modal")
        .setTitle("Edit Territory Filters");

      const input = new TextInputBuilder()
        .setCustomId("territory_ids_input")
        .setLabel("Territory IDs (comma-separated)")
        .setPlaceholder("e.g., LSG, NYC, AFN")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(
        input,
      );
      modal.addComponents(row1);

      await interaction.showModal(modal);
      return;
    }

    if (selectedSetting === "tt_edit_factions") {
      const modal = new ModalBuilder()
        .setCustomId("tt_edit_factions_modal")
        .setTitle("Edit Faction Filters");

      const input = new TextInputBuilder()
        .setCustomId("faction_ids_input")
        .setLabel("Faction IDs (comma-separated)")
        .setPlaceholder("e.g., 1234, 5678, 9012")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(
        input,
      );
      modal.addComponents(row1);

      await interaction.showModal(modal);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in filtered TT settings edit:", errorMsg);
  }
}

export async function handleTTFullChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const selectedChannel = interaction.channels.first();
    if (!selectedChannel || selectedChannel.type !== ChannelType.GuildText) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Invalid Channel")
        .setDescription("Please select a text channel.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    await upsertTTConfig(supabase, guildId, {
      tt_full_channel_id: selectedChannel.id,
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Full Notifications Updated")
      .setDescription(`Full notifications will post in ${selectedChannel}.`);

    const backBtn = new ButtonBuilder()
      .setCustomId("tt_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error updating full TT channel:", errorMsg);
  }
}

export async function handleTTFilteredChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const selectedChannel = interaction.channels.first();
    if (!selectedChannel || selectedChannel.type !== ChannelType.GuildText) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Invalid Channel")
        .setDescription("Please select a text channel.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    await upsertTTConfig(supabase, guildId, {
      tt_filtered_channel_id: selectedChannel.id,
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Filtered Notifications Updated")
      .setDescription(
        `Filtered notifications will post in ${selectedChannel}.`,
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("tt_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error updating filtered TT channel:", errorMsg);
  }
}

export async function handleTTFullChannelClear(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    await upsertTTConfig(supabase, guildId, {
      tt_full_channel_id: null,
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Full Notifications Disabled")
      .setDescription("Full territory notifications have been disabled.");

    const backBtn = new ButtonBuilder()
      .setCustomId("tt_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error clearing full TT channel:", errorMsg);
  }
}

export async function handleTTFilteredChannelClear(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    await upsertTTConfig(supabase, guildId, {
      tt_filtered_channel_id: null,
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Filtered Notifications Disabled")
      .setDescription("Filtered territory notifications have been disabled.");

    const backBtn = new ButtonBuilder()
      .setCustomId("tt_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error clearing filtered TT channel:", errorMsg);
  }
}

export async function handleTTNotificationTypeSelect(
  interaction: StringSelectMenuInteraction,
  _supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Notification Type Deprecated")
      .setDescription(
        "Notification type selection has been replaced by Full and Filtered channels.",
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("tt_settings_show")
      .setLabel("Back to TT Settings")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error updating notification type:", errorMsg);
  }
}

export async function handleTTEditTerritoriesModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const input = interaction.fields.getTextInputValue("territory_ids_input");
    const territoryIds = input
      .split(",")
      .map((id) => id.trim().toUpperCase())
      .filter((id) => id.length > 0);

    await upsertTTConfig(supabase, guildId, {
      tt_territory_ids: territoryIds,
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Territory Filters Updated")
      .setDescription(
        territoryIds.length > 0
          ? `Monitoring: **${territoryIds.join(", ")}**`
          : "Territory filter cleared (all territories will be monitored)",
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("tt_settings_show")
      .setLabel("Back to TT Settings")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error updating territory filters:", errorMsg);
  }
}

export async function handleTTEditFactionsModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const input = interaction.fields.getTextInputValue("faction_ids_input");
    const factionIds = input
      .split(",")
      .map((id) => parseInt(id.trim()))
      .filter((id) => !isNaN(id));

    await upsertTTConfig(supabase, guildId, {
      tt_faction_ids: factionIds,
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Faction Filters Updated")
      .setDescription(
        factionIds.length > 0
          ? `Monitoring: **${factionIds.join(", ")}**`
          : "Faction filter cleared (all factions will be monitored)",
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("tt_settings_show")
      .setLabel("Back to TT Settings")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error updating faction filters:", errorMsg);
  }
}
