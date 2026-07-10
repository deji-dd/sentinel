/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { GuildConfigs } from "@sentinel/shared";

export type ConfigInteraction =
  | StringSelectMenuInteraction
  | ButtonInteraction
  | ChannelSelectMenuInteraction
  | ModalSubmitInteraction;

function getConfigSessionUserId(
  footerText?: string,
  defaultUserId?: string,
): string {
  if (!footerText) return defaultUserId || "";
  const match = footerText.match(/Config Session:\s*(\d+)/);
  return match ? match[1] : defaultUserId || "";
}

function parseTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === "string",
        );
      }
    } catch {
      return [];
    }
  }

  return [];
}

export async function handleShowTerritoriesSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const guildConfig = GuildConfigs.findOne(guildId);

    // Parse enabled_modules
    const enabledModules: string[] = guildConfig?.enabled_modules || [];

    if (!enabledModules.includes("territories")) {
      const disabledEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Territories Module Disabled")
        .setDescription(
          "This guild has not enabled the territories module yet. Use personal admin module management to enable it first.",
        );

      await interaction.editReply({
        embeds: [disabledEmbed],
        components: [],
      });
      return;
    }

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Territories Settings")
      .setDescription(
        "Configure territory assault checkers, notification channels, and watched territories/factions below.",
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const select = new StringSelectMenuBuilder()
      .setCustomId("config_territories_setting_select")
      .setPlaceholder("Select a setting to edit...")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Full Notifications Channel")
          .setValue("set_full_notifications_channel")
          .setDescription("Channel where all territory assault notifications are posted"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Filtered Notifications Channel")
          .setValue("set_filtered_notifications_channel")
          .setDescription("Channel where watched territory/faction alerts are posted"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Watched Territories")
          .setValue("set_watched_territories")
          .setDescription("Configure territory IDs to watch for filtered alerts"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Watched Factions")
          .setValue("set_watched_factions")
          .setDescription("Configure faction IDs to watch for filtered alerts"),
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_to_menu")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const rowSelect =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [rowSelect, rowBtn],
    });
  } catch (error) {
    console.error("Error showing territories settings:", error);
  }
}

export async function handleTerritoriesSettingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    const selected = interaction.values[0];
    if (selected === "set_full_notifications_channel") {
      await handleTerritoriesSetFullChannel(interaction);
    } else if (selected === "set_filtered_notifications_channel") {
      await handleTerritoriesSetFilteredChannel(interaction);
    } else if (selected === "set_watched_territories") {
      await handleShowWatchedTerritoriesSettings(interaction);
    } else if (selected === "set_watched_factions") {
      await handleShowWatchedFactionsSettings(interaction);
    }
  } catch (error) {
    console.error("Error in handleTerritoriesSettingSelect:", error);
  }
}

export async function handleTerritoriesSetFullChannel(
  interaction: ConfigInteraction,
): Promise<void> {
  try {
    if ("deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = GuildConfigs.findOne(guildId);

    const currentChannel = config?.tt_full_channel_id
      ? `<#${config.tt_full_channel_id}>`
      : "Not configured";

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Select Full Notifications Channel")
      .setDescription(
        `Choose the channel where all territory assault notifications will be posted.\n\n**Current Channel:** ${currentChannel}`,
      );

    const channelSelect =
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("territories_full_channel_select")
          .setPlaceholder("Select a text channel")
          .addChannelTypes(ChannelType.GuildText),
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("territories_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [channelSelect, row],
    });
  } catch (error) {
    console.error("Error setting full channel:", error);
  }
}

export async function handleTerritoriesSetFilteredChannel(
  interaction: ConfigInteraction,
): Promise<void> {
  try {
    if ("deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = GuildConfigs.findOne(guildId);

    const currentChannel = config?.tt_filtered_channel_id
      ? `<#${config.tt_filtered_channel_id}>`
      : "Not configured";

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Select Filtered Notifications Channel")
      .setDescription(
        `Choose the channel where only notifications for watched territories and factions will be posted.\n\n**Current Channel:** ${currentChannel}`,
      );

    const channelSelect =
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("territories_filtered_channel_select")
          .setPlaceholder("Select a text channel")
          .addChannelTypes(ChannelType.GuildText),
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("territories_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [channelSelect, row],
    });
  } catch (error) {
    console.error("Error setting filtered channel:", error);
  }
}

export async function handleTerritoriesFullChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const channelId = interaction.values[0];
    if (!guildId || !channelId) return;

    const c = GuildConfigs.findOne(guildId);
    if (c) {
      c.tt_full_channel_id = channelId;
      c.updated_at = new Date().toISOString();
      GuildConfigs.update(c);
    }

    await handleShowTerritoriesSettings(interaction, true);
  } catch (error) {
    console.error("Error in territories full channel select:", error);
  }
}

export async function handleTerritoriesFilteredChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const channelId = interaction.values[0];
    if (!guildId || !channelId) return;

    const c = GuildConfigs.findOne(guildId);
    if (c) {
      c.tt_filtered_channel_id = channelId;
      c.updated_at = new Date().toISOString();
      GuildConfigs.update(c);
    }

    await handleShowTerritoriesSettings(interaction, true);
  } catch (error) {
    console.error("Error in territories filtered channel select:", error);
  }
}

export async function handleShowWatchedTerritoriesSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = GuildConfigs.findOne(guildId);

    const territoryList = parseTextArray(config?.tt_territory_ids);
    const displayList =
      territoryList.length > 0 ? territoryList.join(", ") : "None";

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Watched Territory IDs")
      .setDescription(
        "Configure the list of territory IDs that you want to watch. Separate multiple IDs with commas.\n\n" +
          `**Current Watched Territories:** \`${displayList}\``,
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const editBtn = new ButtonBuilder()
      .setCustomId("territories_set_watched_territories_btn")
      .setLabel("Edit Watched Territories")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("territories_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(editBtn, backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error in handleShowWatchedTerritoriesSettings:", error);
  }
}

export async function handleTerritoriesSetWatchedTerritoriesBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = GuildConfigs.findOne(guildId);

    const territoryList = parseTextArray(config?.tt_territory_ids);
    const currentValue = territoryList.join(", ");

    const modal = new ModalBuilder()
      .setCustomId("territories_watched_territories_modal")
      .setTitle("Edit Watched Territories");

    const input = new TextInputBuilder()
      .setCustomId("territories_input")
      .setLabel("Territory IDs (comma-separated)")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("e.g. AB12, CD34, EF56")
      .setRequired(false)
      .setValue(currentValue);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error in territories set watched btn:", error);
  }
}

export async function handleTerritoriesWatchedTerritoriesModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const value = interaction.fields
      .getTextInputValue("territories_input")
      .trim();

    const territories = value
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter((t) => t.length > 0);

    const c = GuildConfigs.findOne(guildId);
    if (c) {
      c.tt_territory_ids = territories;
      c.updated_at = new Date().toISOString();
      GuildConfigs.update(c);
    }

    await handleShowWatchedTerritoriesSettings(interaction, true);
  } catch (error) {
    console.error("Error in territories watched modal submit:", error);
  }
}

export async function handleShowWatchedFactionsSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = GuildConfigs.findOne(guildId);

    const factionList = parseTextArray(config?.tt_faction_ids);
    const displayList =
      factionList.length > 0 ? factionList.join(", ") : "None";

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Watched Faction IDs")
      .setDescription(
        "Configure the list of faction IDs that you want to watch. Separate multiple IDs with commas.\n\n" +
          `**Current Watched Factions:** \`${displayList}\``,
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const editBtn = new ButtonBuilder()
      .setCustomId("territories_set_watched_factions_btn")
      .setLabel("Edit Watched Factions")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("territories_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(editBtn, backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error in handleShowWatchedFactionsSettings:", error);
  }
}

export async function handleTerritoriesSetWatchedFactionsBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = GuildConfigs.findOne(guildId);

    const factionList = parseTextArray(config?.tt_faction_ids);
    const currentValue = factionList.join(", ");

    const modal = new ModalBuilder()
      .setCustomId("territories_watched_factions_modal")
      .setTitle("Edit Watched Factions");

    const input = new TextInputBuilder()
      .setCustomId("factions_input")
      .setLabel("Faction IDs (comma-separated)")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("e.g. 1234, 5678")
      .setRequired(false)
      .setValue(currentValue);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error in territories set watched factions btn:", error);
  }
}

export async function handleTerritoriesWatchedFactionsModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const value = interaction.fields
      .getTextInputValue("factions_input")
      .trim();

    const factions = value
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && !isNaN(parseInt(f, 10)));

    const c = GuildConfigs.findOne(guildId);
    if (c) {
      c.tt_faction_ids = factions;
      c.updated_at = new Date().toISOString();
      GuildConfigs.update(c);
    }

    await handleShowWatchedFactionsSettings(interaction, true);
  } catch (error) {
    console.error("Error in territories watched factions modal submit:", error);
  }
}
