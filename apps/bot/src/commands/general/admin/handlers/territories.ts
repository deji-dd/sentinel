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
import { TABLE_NAMES, getFactionDataBatchCached } from "@sentinel/shared";
import { getGuildApiKeys } from "../../../../lib/guild-api-keys.js";
import { supabase } from "../../../../lib/supabase.js";
import { tornApi } from "../../../../services/torn-client.js";

interface TTConfig {
  guild_id: string;
  tt_full_channel_id: string | null;
  tt_filtered_channel_id: string | null;
  tt_territory_ids: string[];
  tt_faction_ids: number[];
}

interface WarLedgerRow {
  war_id: number;
  territory_id: string;
  assaulting_faction: number;
  defending_faction: number;
  start_time: string;
  end_time: string;
}

interface WarTrackerRow {
  guild_id: string;
  war_id: number;
  territory_id: string;
  channel_id: string | null;
  message_id: string | null;
  enemy_side: "assaulting" | "defending";
  min_away_minutes: number;
}

const WAR_PAGE_SIZE = 10;

async function getTTConfig(guildId: string): Promise<TTConfig> {
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

async function getActiveApiKey(guildId: string): Promise<string | null> {
  const apiKeys = await getGuildApiKeys(guildId);
  return apiKeys.length > 0 ? apiKeys[0] : null;
}

async function getFactionNameMap(
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
    tornApi,
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
): Promise<void> {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getTTConfig(guildId);
    const apiKey = await getActiveApiKey(guildId);
    const factionNameMap = await getFactionNameMap(
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
      new StringSelectMenuOptionBuilder()
        .setLabel("Manage Live War Tracking")
        .setValue("tt_war_tracking")
        .setDescription("Configure per-war live tracker settings"),
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
): Promise<void> {
  try {
    const selectedSetting = interaction.values[0];

    if (selectedSetting === "tt_full") {
      await showFullTTSettings(interaction);
    } else if (selectedSetting === "tt_filtered") {
      await showFilteredTTSettings(interaction);
    } else if (selectedSetting === "tt_war_tracking") {
      await showTTWarList(interaction, 0);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in TT settings edit:", errorMsg);
  }
}

async function getActiveWars(): Promise<WarLedgerRow[]> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.WAR_LEDGER)
    .select(
      "war_id, territory_id, assaulting_faction, defending_faction, start_time, end_time",
    )
    .is("end_time", null)
    .order("start_time", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

function buildWarOptionLabel(
  war: WarLedgerRow,
  names: Map<number, string>,
): string {
  const assaulting = names.get(war.assaulting_faction)
    ? names.get(war.assaulting_faction)
    : `Faction ${war.assaulting_faction}`;
  const defending = names.get(war.defending_faction)
    ? names.get(war.defending_faction)
    : `Faction ${war.defending_faction}`;

  return `${war.territory_id}: ${assaulting} vs ${defending}`;
}

async function getOrCreateWarTracker(
  guildId: string,
  war: WarLedgerRow,
): Promise<WarTrackerRow> {
  // First, try to fetch existing tracker
  const { data: existingTracker, error: _fetchError } = await supabase
    .from(TABLE_NAMES.WAR_TRACKERS)
    .select(
      "guild_id, war_id, territory_id, channel_id, message_id, enemy_side, min_away_minutes",
    )
    .eq("guild_id", guildId)
    .eq("war_id", war.war_id)
    .single();

  // If tracker exists, return it (don't overwrite settings)
  if (existingTracker) {
    return existingTracker as WarTrackerRow;
  }

  // Only create if it doesn't exist
  const { data: newTracker, error: createError } = await supabase
    .from(TABLE_NAMES.WAR_TRACKERS)
    .insert({
      guild_id: guildId,
      war_id: war.war_id,
      territory_id: war.territory_id,
      enemy_side: "defending",
      min_away_minutes: 0,
      updated_at: new Date().toISOString(),
    })
    .select(
      "guild_id, war_id, territory_id, channel_id, message_id, enemy_side, min_away_minutes",
    )
    .single();

  if (createError || !newTracker) {
    throw createError || new Error("Failed to create war tracker");
  }

  return newTracker as WarTrackerRow;
}

async function updateWarTrackerRow(
  guildId: string,
  warId: number,
  updates: Partial<WarTrackerRow>,
): Promise<void> {
  await supabase
    .from(TABLE_NAMES.WAR_TRACKERS)
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("guild_id", guildId)
    .eq("war_id", warId);
}

function parseWarAndPage(customId: string): { warId: number; page: number } {
  const parts = customId.split(":");
  const warId = Number(parts[1]);
  const page = Number(parts[2]);
  return {
    warId: Number.isNaN(warId) ? NaN : warId,
    page: Number.isNaN(page) ? 0 : page,
  };
}

async function showTTWarList(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  page = 0,
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  const wars = await getActiveWars();
  if (wars.length === 0) {
    const emptyEmbed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("No Active Territory Wars")
      .setDescription("No active wars are currently tracked in the ledger.");

    const backBtn = new ButtonBuilder()
      .setCustomId("tt_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [emptyEmbed],
      components: [row],
    });
    return;
  }

  const guildId = interaction.guildId;
  const apiKey = guildId ? await getActiveApiKey(guildId) : null;
  const factionIds = Array.from(
    new Set(
      wars.flatMap((war) => [war.assaulting_faction, war.defending_faction]),
    ),
  );
  const factionNameMap = await getFactionNameMap(factionIds, apiKey);

  const totalPages = Math.ceil(wars.length / WAR_PAGE_SIZE);
  const pageIndex = Math.min(Math.max(page, 0), totalPages - 1);
  const pageWars = wars.slice(
    pageIndex * WAR_PAGE_SIZE,
    pageIndex * WAR_PAGE_SIZE + WAR_PAGE_SIZE,
  );

  const trackerMap = new Map<number, WarTrackerRow>();
  if (guildId && pageWars.length > 0) {
    const warIds = pageWars.map((war) => war.war_id);
    const { data: trackers } = await supabase
      .from(TABLE_NAMES.WAR_TRACKERS)
      .select(
        "guild_id, war_id, territory_id, channel_id, message_id, enemy_side, min_away_minutes",
      )
      .eq("guild_id", guildId)
      .in("war_id", warIds);

    if (trackers) {
      for (const tracker of trackers) {
        trackerMap.set(tracker.war_id, tracker as WarTrackerRow);
      }
    }
  }

  const options = pageWars.map((war) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(buildWarOptionLabel(war, factionNameMap))
      .setValue(String(war.war_id))
      .setDescription(`Manage tracker for war ${war.war_id}`),
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`tt_war_track_select:${pageIndex}`)
    .setPlaceholder("Select a war to manage")
    .addOptions(options);

  const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    selectMenu,
  );

  const navButtons: ButtonBuilder[] = [];
  if (pageIndex > 0) {
    navButtons.push(
      new ButtonBuilder()
        .setCustomId(`tt_war_track_page_prev:${pageIndex - 1}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (pageIndex < totalPages - 1) {
    navButtons.push(
      new ButtonBuilder()
        .setCustomId(`tt_war_track_page_next:${pageIndex + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  navButtons.push(
    new ButtonBuilder()
      .setCustomId("tt_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary),
  );

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    navButtons,
  );

  const warListLines = pageWars.map((war, index) => {
    const displayIndex = pageIndex * WAR_PAGE_SIZE + index + 1;
    const assaulting = factionNameMap.get(war.assaulting_faction)
      ? factionNameMap.get(war.assaulting_faction)
      : `Faction ${war.assaulting_faction}`;
    const defending = factionNameMap.get(war.defending_faction)
      ? factionNameMap.get(war.defending_faction)
      : `Faction ${war.defending_faction}`;
    const tracker = trackerMap.get(war.war_id);
    const enabled = !!tracker?.channel_id;
    const statusEmoji = enabled
      ? "<:Green:1474607376140079104>"
      : "<:Red:1474607810368114886>";

    return `${displayIndex}. ${statusEmoji} [${war.territory_id}] ${assaulting} vs ${defending}`;
  });

  const warFieldLines: string[] = [];
  let warFieldLength = 0;
  for (const line of warListLines) {
    const addition = warFieldLines.length === 0 ? line.length : line.length + 1;
    if (warFieldLength + addition > 1024) {
      break;
    }
    warFieldLines.push(line);
    warFieldLength += addition;
  }

  const hiddenLines = warListLines.length - warFieldLines.length;
  if (hiddenLines > 0) {
    const moreLine = `…and ${hiddenLines} more on this page`;
    if (warFieldLength + moreLine.length + 1 <= 1024) {
      warFieldLines.push(moreLine);
    }
  }

  const listEmbed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("Live War Tracking")
    .setDescription("Select an active war to configure live tracking.")
    .addFields({
      name: "Current Wars",
      value: warFieldLines.join("\n"),
      inline: false,
    })
    .setFooter({ text: `Page ${pageIndex + 1} of ${totalPages}` });

  await interaction.editReply({
    embeds: [listEmbed],
    components: [menuRow, navRow],
  });
}

async function showTTWarTrackerSettings(
  interaction:
    | StringSelectMenuInteraction
    | ButtonInteraction
    | ChannelSelectMenuInteraction
    | ModalSubmitInteraction,
  warId: number,
  page: number,
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  const guildId = interaction.guildId;
  if (!guildId) return;

  const wars = await getActiveWars();
  const war = wars.find((entry) => entry.war_id === warId);
  if (!war) {
    const missingEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("War Not Found")
      .setDescription("That war is no longer active.");

    const backBtn = new ButtonBuilder()
      .setCustomId(`tt_war_track_back:${page}`)
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [missingEmbed],
      components: [row],
    });
    return;
  }

  const tracker = await getOrCreateWarTracker(guildId, war);
  const apiKey = await getActiveApiKey(guildId);
  const assaultingName =
    (await getFactionNameMap([war.assaulting_faction], apiKey)).get(
      war.assaulting_faction,
    ) || `Faction ${war.assaulting_faction}`;
  const defendingName =
    (await getFactionNameMap([war.defending_faction], apiKey)).get(
      war.defending_faction,
    ) || `Faction ${war.defending_faction}`;

  const trackerEmbed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle(`Manage War ${war.territory_id}`)
    .addFields(
      {
        name: "Assaulting",
        value: assaultingName,
        inline: true,
      },
      {
        name: "Defending",
        value: defendingName,
        inline: true,
      },
      {
        name: "Status",
        value: tracker.channel_id ? "Enabled" : "Disabled",
        inline: false,
      },
      {
        name: "Channel",
        value: tracker.channel_id ? `<#${tracker.channel_id}>` : "Disabled",
        inline: false,
      },
      {
        name: "Enemy Faction",
        value:
          tracker.enemy_side === "assaulting" ? assaultingName : defendingName,
        inline: false,
      },
      {
        name: "Away Filter",
        value:
          tracker.min_away_minutes > 0
            ? `>= ${tracker.min_away_minutes} minutes`
            : "Off",
        inline: false,
      },
    )
    .setFooter({ text: `War ID ${war.war_id}` });

  const channelSelectMenu = new ChannelSelectMenuBuilder()
    .setCustomId(`tt_war_track_channel_select:${war.war_id}:${page}`)
    .setPlaceholder("Select channel for live tracker")
    .addChannelTypes(ChannelType.GuildText);

  const enemySideMenu = new StringSelectMenuBuilder()
    .setCustomId(`tt_war_track_enemy_side:${war.war_id}:${page}`)
    .setPlaceholder("Select which faction is enemy")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Assaulting")
        .setValue("assaulting")
        .setDefault(tracker.enemy_side === "assaulting"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Defending")
        .setValue("defending")
        .setDefault(tracker.enemy_side === "defending"),
    );

  const awayFilterBtn = new ButtonBuilder()
    .setCustomId(`tt_war_track_away_filter:${war.war_id}:${page}`)
    .setLabel("Set Away Filter")
    .setStyle(ButtonStyle.Secondary);

  const disableBtn = new ButtonBuilder()
    .setCustomId(`tt_war_track_channel_clear:${war.war_id}:${page}`)
    .setLabel("Disable Tracking")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!tracker.channel_id);

  const backBtn = new ButtonBuilder()
    .setCustomId(`tt_war_track_back:${page}`)
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const channelRow =
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      channelSelectMenu,
    );
  const enemyRow =
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      enemySideMenu,
    );
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    awayFilterBtn,
    disableBtn,
    backBtn,
  );

  await interaction.editReply({
    embeds: [trackerEmbed],
    components: [channelRow, enemyRow, buttonRow],
  });
}

export async function handleTTWarTrackPage(
  interaction: ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const page = parts.length > 1 ? Number(parts[1]) : 0;
  await showTTWarList(interaction, Number.isNaN(page) ? 0 : page);
}

export async function handleTTWarTrackSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const warId = Number(interaction.values[0]);
  const parts = interaction.customId.split(":");
  const page = parts.length > 1 ? Number(parts[1]) : 0;

  if (Number.isNaN(warId)) {
    return;
  }

  await showTTWarTrackerSettings(
    interaction,
    warId,
    Number.isNaN(page) ? 0 : page,
  );
}

export async function handleTTWarTrackBack(
  interaction: ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const page = parts.length > 1 ? Number(parts[1]) : 0;
  await showTTWarList(interaction, Number.isNaN(page) ? 0 : page);
}

export async function handleTTWarTrackChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  const { warId, page } = parseWarAndPage(interaction.customId);
  if (Number.isNaN(warId)) return;

  const guildId = interaction.guildId;
  if (!guildId) return;

  const selectedChannel = interaction.channels.first();
  if (!selectedChannel || selectedChannel.type !== ChannelType.GuildText) {
    await interaction.deferUpdate();
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Invalid Channel")
      .setDescription("Please select a text channel.");

    const backBtn = new ButtonBuilder()
      .setCustomId(`tt_war_track_back:${page}`)
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [errorEmbed],
      components: [row],
    });
    return;
  }

  const apiKey = await getActiveApiKey(guildId);
  if (!apiKey) {
    await interaction.deferUpdate();
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Missing API Key")
      .setDescription("Add an active API key before enabling live tracking.");

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_admin_settings")
      .setLabel("Back to Admin Settings")
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [errorEmbed],
      components: [row],
    });
    return;
  }

  await updateWarTrackerRow(guildId, warId, {
    channel_id: selectedChannel.id,
  });

  await showTTWarTrackerSettings(interaction, warId, page);
}

export async function handleTTWarTrackChannelClear(
  interaction: ButtonInteraction,
): Promise<void> {
  const { warId, page } = parseWarAndPage(interaction.customId);
  if (Number.isNaN(warId)) return;

  const guildId = interaction.guildId;
  if (!guildId) return;

  // Fetch current tracker to get message_id
  const { data: currentTracker } = await supabase
    .from(TABLE_NAMES.WAR_TRACKERS)
    .select("channel_id, message_id")
    .eq("guild_id", guildId)
    .eq("war_id", warId)
    .single();

  // Delete the tracked message if it exists
  if (currentTracker?.channel_id && currentTracker?.message_id) {
    try {
      const channel = await interaction.guild?.channels.fetch(
        currentTracker.channel_id,
      );
      if (channel && channel.isTextBased()) {
        await channel.messages.delete(currentTracker.message_id);
      }
    } catch {
      // Message may already be deleted, continue with clearing tracker
    }
  }

  await updateWarTrackerRow(guildId, warId, {
    channel_id: null,
    message_id: null,
  });

  await showTTWarTrackerSettings(interaction, warId, page);
}

export async function handleTTWarTrackEnemySideSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  const { warId, page } = parseWarAndPage(interaction.customId);
  if (Number.isNaN(warId)) return;

  const guildId = interaction.guildId;
  if (!guildId) return;

  const side =
    interaction.values[0] === "assaulting" ? "assaulting" : "defending";

  await updateWarTrackerRow(guildId, warId, {
    enemy_side: side,
  });

  await showTTWarTrackerSettings(interaction, warId, page);
}

export async function handleTTWarTrackAwayFilterButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const { warId, page } = parseWarAndPage(interaction.customId);
  if (Number.isNaN(warId)) return;

  const modal = new ModalBuilder()
    .setCustomId(`tt_war_track_away_modal:${warId}:${page}`)
    .setTitle("Set Away Filter");

  const input = new TextInputBuilder()
    .setCustomId("away_minutes_input")
    .setLabel("Minimum away minutes (0 to disable)")
    .setPlaceholder("e.g., 10")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

export async function handleTTWarTrackAwayFilterSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const { warId, page } = parseWarAndPage(interaction.customId);
  if (Number.isNaN(warId)) return;

  const guildId = interaction.guildId;
  if (!guildId) return;

  const input = interaction.fields.getTextInputValue("away_minutes_input");
  const minutes = Number.parseInt(input, 10);
  const minAwayMinutes = Number.isNaN(minutes) || minutes < 0 ? 0 : minutes;

  await updateWarTrackerRow(guildId, warId, {
    min_away_minutes: minAwayMinutes,
  });

  await showTTWarTrackerSettings(interaction, warId, page);
}

async function showFullTTSettings(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  const guildId = interaction.guildId;
  if (!guildId) return;

  const config = await getTTConfig(guildId);

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
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  const guildId = interaction.guildId;
  if (!guildId) return;

  const config = await getTTConfig(guildId);
  const apiKey = await getActiveApiKey(guildId);
  const factionNameMap = await getFactionNameMap(config.tt_faction_ids, apiKey);

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

    await upsertTTConfig(guildId, {
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

    await upsertTTConfig(guildId, {
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
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    await upsertTTConfig(guildId, {
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
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    await upsertTTConfig(guildId, {
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

    await upsertTTConfig(guildId, {
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

    await upsertTTConfig(guildId, {
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
