/**
 * Territory war tracker command
 * Allows per-guild tracking of active territory wars with live updates
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TABLE_NAMES,
  getFactionDataBatchCached,
  getFactionNameCached,
} from "@sentinel/shared";
import { decrypt } from "../../../lib/encryption.js";
import { botTornApi } from "../../../lib/torn-api.js";

const PAGE_SIZE = 25;

interface ApiKeyEntry {
  key: string; // encrypted
  fingerprint: string;
  isActive: boolean;
  createdAt: string;
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

export const data = new SlashCommandBuilder()
  .setName("war-track")
  .setDescription("Track an active territory war in a channel");

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
    console.warn("Failed to decrypt API key for war-track:", error);
    return null;
  }
}

async function getActiveWars(
  supabase: SupabaseClient,
): Promise<WarLedgerRow[]> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.WAR_LEDGER)
    .select(
      "war_id, territory_id, assaulting_faction, defending_faction, start_time, end_time",
    )
    .gt("end_time", new Date().toISOString())
    .order("start_time", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
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

  if (!apiKey) {
    const { data: cached } = await supabase
      .from(TABLE_NAMES.TORN_FACTIONS)
      .select("id, name")
      .in("id", factionIds);

    if (cached) {
      for (const faction of cached) {
        nameMap.set(faction.id, faction.name);
      }
    }

    return nameMap;
  }

  const fetched = await getFactionDataBatchCached(
    supabase,
    factionIds,
    botTornApi,
    apiKey,
  );

  for (const [id, data] of fetched.entries()) {
    nameMap.set(id, data.name);
  }

  return nameMap;
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

async function showWarList(
  interaction:
    | ChatInputCommandInteraction
    | StringSelectMenuInteraction
    | ButtonInteraction,
  supabase: SupabaseClient,
  page = 0,
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  const wars = await getActiveWars(supabase);
  if (wars.length === 0) {
    const emptyEmbed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("No Active Territory Wars")
      .setDescription("No active wars are currently tracked in the ledger.");

    await interaction.editReply({
      embeds: [emptyEmbed],
      components: [],
    });
    return;
  }

  const guildId = interaction.guildId;
  const apiKey = guildId ? await getActiveApiKey(supabase, guildId) : null;
  const factionIds = Array.from(
    new Set(
      wars.flatMap((war) => [war.assaulting_faction, war.defending_faction]),
    ),
  );
  const factionNameMap = await getFactionNameMap(supabase, factionIds, apiKey);

  const totalPages = Math.ceil(wars.length / PAGE_SIZE);
  const pageIndex = Math.min(Math.max(page, 0), totalPages - 1);
  const pageWars = wars.slice(
    pageIndex * PAGE_SIZE,
    pageIndex * PAGE_SIZE + PAGE_SIZE,
  );

  const options = pageWars.map((war) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(buildWarOptionLabel(war, factionNameMap))
      .setValue(String(war.war_id)),
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`war_track_select:${pageIndex}`)
    .setPlaceholder("Select a war to track")
    .addOptions(options);

  const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    selectMenu,
  );

  const buttons: ButtonBuilder[] = [];
  if (pageIndex > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`war_track_page_prev:${pageIndex - 1}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (pageIndex < totalPages - 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`war_track_page_next:${pageIndex + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  const buttonRow = buttons.length
    ? new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)
    : null;

  const listEmbed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("Active Territory Wars")
    .setDescription("Select an active war to configure tracking.")
    .setFooter({ text: `Page ${pageIndex + 1} of ${totalPages}` });

  await interaction.editReply({
    embeds: [listEmbed],
    components: buttonRow ? [menuRow, buttonRow] : [menuRow],
  });
}

async function upsertTracker(
  supabase: SupabaseClient,
  guildId: string,
  war: WarLedgerRow,
): Promise<WarTrackerRow> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.WAR_TRACKERS)
    .upsert(
      {
        guild_id: guildId,
        war_id: war.war_id,
        territory_id: war.territory_id,
        enemy_side: "defending",
        min_away_minutes: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "guild_id,war_id" },
    )
    .select(
      "guild_id, war_id, territory_id, channel_id, message_id, enemy_side, min_away_minutes",
    )
    .single();

  if (error || !data) {
    throw error || new Error("Failed to create war tracker");
  }

  return data as WarTrackerRow;
}

async function showTrackerSettings(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
  warId: number,
  page: number,
): Promise<void> {
  await interaction.deferUpdate();

  const guildId = interaction.guildId;
  if (!guildId) return;

  const wars = await getActiveWars(supabase);
  const war = wars.find((entry) => entry.war_id === warId);
  if (!war) {
    const missingEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("War Not Found")
      .setDescription("That war is no longer active.");

    await interaction.editReply({
      embeds: [missingEmbed],
      components: [],
    });
    return;
  }

  const tracker = await upsertTracker(supabase, guildId, war);
  const apiKey = await getActiveApiKey(supabase, guildId);
  const assaultingName =
    (await getFactionNameCached(
      supabase,
      war.assaulting_faction,
      botTornApi,
      apiKey,
    )) || `Faction ${war.assaulting_faction}`;
  const defendingName =
    (await getFactionNameCached(
      supabase,
      war.defending_faction,
      botTornApi,
      apiKey,
    )) || `Faction ${war.defending_faction}`;

  const trackerEmbed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle(`Track War ${war.territory_id}`)
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
        name: "Channel",
        value: tracker.channel_id ? `<#${tracker.channel_id}>` : "Disabled",
        inline: false,
      },
      {
        name: "Enemy Side",
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
    .setCustomId(`war_track_channel_select:${war.war_id}`)
    .setPlaceholder("Select a channel for the tracker")
    .addChannelTypes(ChannelType.GuildText);

  const sideMenu = new StringSelectMenuBuilder()
    .setCustomId(`war_track_enemy_side:${war.war_id}`)
    .setPlaceholder("Select enemy side")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`Assaulting (${assaultingName})`)
        .setValue("assaulting"),
      new StringSelectMenuOptionBuilder()
        .setLabel(`Defending (${defendingName})`)
        .setValue("defending"),
    );

  const disableBtn = new ButtonBuilder()
    .setCustomId(`war_track_channel_clear:${war.war_id}`)
    .setLabel("Disable")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!tracker.channel_id);

  const filterBtn = new ButtonBuilder()
    .setCustomId(`war_track_away_filter:${war.war_id}`)
    .setLabel("Set Away Filter")
    .setStyle(ButtonStyle.Secondary);

  const backBtn = new ButtonBuilder()
    .setCustomId(`war_track_back:${page}`)
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const channelRow =
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      channelSelectMenu,
    );
  const sideRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    sideMenu,
  );
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    filterBtn,
    disableBtn,
    backBtn,
  );

  await interaction.editReply({
    embeds: [trackerEmbed],
    components: [channelRow, sideRow, buttonRow],
  });
}

async function updateTrackerRow(
  supabase: SupabaseClient,
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

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  await showWarList(interaction, supabase, 0);
}

export async function handleWarTrackPage(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const page = parts.length > 1 ? Number(parts[1]) : 0;
  await showWarList(interaction, supabase, Number.isNaN(page) ? 0 : page);
}

export async function handleWarTrackSelect(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  const warId = Number(interaction.values[0]);
  const parts = interaction.customId.split(":");
  const page = parts.length > 1 ? Number(parts[1]) : 0;

  if (Number.isNaN(warId)) {
    return;
  }

  await showTrackerSettings(interaction, supabase, warId, page);
}

export async function handleWarTrackBack(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const page = parts.length > 1 ? Number(parts[1]) : 0;
  await showWarList(interaction, supabase, Number.isNaN(page) ? 0 : page);
}

export async function handleWarTrackChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  await interaction.deferUpdate();

  const guildId = interaction.guildId;
  if (!guildId) return;

  const warId = Number(interaction.customId.split(":")[1]);
  if (Number.isNaN(warId)) return;

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

  const apiKey = await getActiveApiKey(supabase, guildId);
  if (!apiKey) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Missing API Key")
      .setDescription("Add an active API key before enabling tracking.");

    await interaction.editReply({
      embeds: [errorEmbed],
      components: [],
    });
    return;
  }

  await updateTrackerRow(supabase, guildId, warId, {
    channel_id: selectedChannel.id,
  });

  const successEmbed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("Tracker Channel Set")
    .setDescription(`Updates will post in ${selectedChannel}.`);

  const backBtn = new ButtonBuilder()
    .setCustomId(`war_track_back:0`)
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

  await interaction.editReply({
    embeds: [successEmbed],
    components: [row],
  });
}

export async function handleWarTrackChannelClear(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  await interaction.deferUpdate();

  const guildId = interaction.guildId;
  if (!guildId) return;

  const warId = Number(interaction.customId.split(":")[1]);
  if (Number.isNaN(warId)) return;

  await updateTrackerRow(supabase, guildId, warId, {
    channel_id: null,
    message_id: null,
  });

  const successEmbed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("Tracker Disabled")
    .setDescription("War tracking has been disabled for this war.");

  const backBtn = new ButtonBuilder()
    .setCustomId(`war_track_back:0`)
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

  await interaction.editReply({
    embeds: [successEmbed],
    components: [row],
  });
}

export async function handleWarTrackEnemySideSelect(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  await interaction.deferUpdate();

  const guildId = interaction.guildId;
  if (!guildId) return;

  const warId = Number(interaction.customId.split(":")[1]);
  if (Number.isNaN(warId)) return;

  const side =
    interaction.values[0] === "assaulting" ? "assaulting" : "defending";

  await updateTrackerRow(supabase, guildId, warId, {
    enemy_side: side,
  });

  const successEmbed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("Enemy Side Updated")
    .setDescription(`Enemy side set to **${side}**.`);

  const backBtn = new ButtonBuilder()
    .setCustomId(`war_track_back:0`)
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

  await interaction.editReply({
    embeds: [successEmbed],
    components: [row],
  });
}

export async function handleWarTrackAwayFilterButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const warId = interaction.customId.split(":")[1];
  const modal = new ModalBuilder()
    .setCustomId(`war_track_away_modal:${warId}`)
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

export async function handleWarTrackAwayFilterSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  await interaction.deferUpdate();

  const guildId = interaction.guildId;
  if (!guildId) return;

  const warId = Number(interaction.customId.split(":")[1]);
  if (Number.isNaN(warId)) return;

  const input = interaction.fields.getTextInputValue("away_minutes_input");
  const minutes = Number.parseInt(input, 10);
  const minAwayMinutes = Number.isNaN(minutes) || minutes < 0 ? 0 : minutes;

  await updateTrackerRow(supabase, guildId, warId, {
    min_away_minutes: minAwayMinutes,
  });

  const successEmbed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("Away Filter Updated")
    .setDescription(
      minAwayMinutes > 0
        ? `Showing enemy users away for at least ${minAwayMinutes} minutes.`
        : "Away filter disabled.",
    );

  const backBtn = new ButtonBuilder()
    .setCustomId(`war_track_back:0`)
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

  await interaction.editReply({
    embeds: [successEmbed],
    components: [row],
  });
}
