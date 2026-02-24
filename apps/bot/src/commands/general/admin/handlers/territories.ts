/**
 * Territory (TT) module settings handlers
 * Manages TT notifications, territory filters, and faction filters
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";

interface TTConfig {
  guild_id: string;
  notification_type: "all" | "territories" | "factions" | "combined";
  territory_ids: string[];
  faction_ids: number[];
}

export async function handleShowTTSettings(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    // Get TT config
    const { data: ttConfig } = await supabase
      .from(TABLE_NAMES.TT_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

    const config: TTConfig = ttConfig || {
      guild_id: guildId,
      notification_type: "all",
      territory_ids: [],
      faction_ids: [],
    };

    const notificationTypeDisplay = {
      all: "💬 Monitor all territory changes",
      territories: "🗺️ Specific territories only",
      factions: "💪 Specific factions only",
      combined: "🔀 Territories AND factions",
    };

    const ttEmbed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("Territories Settings")
      .addFields(
        {
          name: "Notification Type",
          value: notificationTypeDisplay[config.notification_type],
          inline: false,
        },
        {
          name: "Territories Monitored",
          value:
            config.territory_ids.length > 0
              ? config.territory_ids.join(", ")
              : "None (all territories when type is 'all')",
          inline: false,
        },
        {
          name: "Factions Monitored",
          value:
            config.faction_ids.length > 0
              ? config.faction_ids.map(String).join(", ")
              : "None (no faction filtering)",
          inline: false,
        },
      );

    const settingOptions = [
      new StringSelectMenuOptionBuilder()
        .setLabel("Notification Type")
        .setValue("tt_edit_type")
        .setDescription("What changes trigger alerts"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Edit Territory Filters")
        .setValue("tt_edit_territories")
        .setDescription("Specify which territories to monitor"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Edit Faction Filters")
        .setValue("tt_edit_factions")
        .setDescription("Specify which factions to monitor"),
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
  _supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const selectedSetting = interaction.values[0];

    if (selectedSetting === "tt_edit_type") {
      // Show type selection
      const typeOptions = [
        new StringSelectMenuOptionBuilder()
          .setLabel("All Changes")
          .setValue("type_all")
          .setDescription("Alert on all territory ownership changes"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Specific Territories")
          .setValue("type_territories")
          .setDescription("Only alert for selected territories"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Specific Factions")
          .setValue("type_factions")
          .setDescription("Only alert when selected factions gain/lose"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Combined (Territories + Factions)")
          .setValue("type_combined")
          .setDescription(
            "Alert if any territory in list OR any faction in list changes",
          ),
      ];

      const typeMenu = new StringSelectMenuBuilder()
        .setCustomId("tt_notification_type_select")
        .setPlaceholder("Choose notification type...")
        .addOptions(typeOptions);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        typeMenu,
      );

      await interaction.editReply({
        components: [row],
      });
    } else if (selectedSetting === "tt_edit_territories") {
      // Show modal for territory IDs
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
    } else if (selectedSetting === "tt_edit_factions") {
      // Show modal for faction IDs
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
    console.error("Error in TT settings edit:", errorMsg);
  }
}

export async function handleTTNotificationTypeSelect(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const typeValue = interaction.values[0];
    const newType = typeValue.replace("type_", "") as
      | "all"
      | "territories"
      | "factions"
      | "combined";

    // Ensure TT config exists
    const { data: existing } = await supabase
      .from(TABLE_NAMES.TT_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

    if (!existing) {
      await supabase.from(TABLE_NAMES.TT_CONFIG).insert({
        guild_id: guildId,
        notification_type: newType,
      });
    } else {
      await supabase
        .from(TABLE_NAMES.TT_CONFIG)
        .update({ notification_type: newType })
        .eq("guild_id", guildId);
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Notification Type Updated")
      .setDescription(`Now using: **${newType}** notification filtering`);

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

    // Ensure TT config exists
    const { data: existing } = await supabase
      .from(TABLE_NAMES.TT_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

    if (!existing) {
      await supabase.from(TABLE_NAMES.TT_CONFIG).insert({
        guild_id: guildId,
        territory_ids: territoryIds,
      });
    } else {
      await supabase
        .from(TABLE_NAMES.TT_CONFIG)
        .update({ territory_ids: territoryIds })
        .eq("guild_id", guildId);
    }

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

    // Ensure TT config exists
    const { data: existing } = await supabase
      .from(TABLE_NAMES.TT_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

    if (!existing) {
      await supabase.from(TABLE_NAMES.TT_CONFIG).insert({
        guild_id: guildId,
        faction_ids: factionIds,
      });
    } else {
      await supabase
        .from(TABLE_NAMES.TT_CONFIG)
        .update({ faction_ids: factionIds })
        .eq("guild_id", guildId);
    }

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
