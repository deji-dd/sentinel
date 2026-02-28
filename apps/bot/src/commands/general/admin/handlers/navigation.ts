/**
 * Navigation handlers for config command menus
 * Handles menu navigation (back buttons, view selection)
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getGuildApiKeys } from "../../../../lib/guild-api-keys.js";
import { supabase } from "../../../../lib/supabase.js";

export async function handleViewSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const selectedView = interaction.values[0];

    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

    if (!guildConfig) return;

    if (selectedView === "view_admin") {
      // Show admin settings
      const apiKeys = await getGuildApiKeys(guildId);

      let apiKeyDisplay = "No keys configured";
      if (apiKeys.length > 0) {
        apiKeyDisplay = apiKeys
          .map((key, idx) => {
            const status =
              idx === 0
                ? "<:Green:1474607376140079104>"
                : "<:Red:1474607810368114886>";
            return `${status} ...${key.slice(-4)}`;
          })
          .join("\n");
      }

      const logChannelDisplay = guildConfig.log_channel_id
        ? `<#${guildConfig.log_channel_id}>`
        : "Not configured";

      const adminEmbed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle("Admin Settings")
        .addFields(
          {
            name: "API Keys",
            value: apiKeyDisplay,
            inline: false,
          },
          {
            name: "Log Channel",
            value: logChannelDisplay,
            inline: false,
          },
        );

      const apiKeysBtn = new ButtonBuilder()
        .setCustomId("config_edit_api_keys")
        .setLabel("Manage API Keys")
        .setStyle(ButtonStyle.Primary);

      const logChannelBtn = new ButtonBuilder()
        .setCustomId("config_edit_log_channel")
        .setLabel("Set Log Channel")
        .setStyle(ButtonStyle.Primary);

      const backBtn = new ButtonBuilder()
        .setCustomId("config_back_to_menu")
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary);

      const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        apiKeysBtn,
        logChannelBtn,
        backBtn,
      );

      await interaction.editReply({
        embeds: [adminEmbed],
        components: [buttonRow],
      });
    } else if (selectedView === "view_verify") {
      // Show verification settings (imported from verification.ts)
      // This will be called separately - just return for now
      return;
    } else if (selectedView === "view_territories") {
      // Show territories settings (imported from territories.ts)
      // This will be called separately - just return for now
      return;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in view select handler:", errorMsg);
  }
}

export async function handleBackToMenu(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const mainEmbed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle("Guild Configuration")
      .setDescription("Select a category to configure");

    const viewOptions = [
      new StringSelectMenuOptionBuilder()
        .setLabel("Verification Settings")
        .setValue("view_verify")
        .setDescription("Auto-verify, roles, and sync"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Admin Settings")
        .setValue("view_admin")
        .setDescription("API keys and logging"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Territories Settings")
        .setValue("view_territories")
        .setDescription("TT notifications and filters"),
    ];

    const viewMenu = new StringSelectMenuBuilder()
      .setCustomId("config_view_select")
      .setPlaceholder("Select a category...")
      .addOptions(viewOptions);

    const menuRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(viewMenu);

    await interaction.editReply({
      embeds: [mainEmbed],
      components: [menuRow],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in back to menu handler:", errorMsg);
  }
}
