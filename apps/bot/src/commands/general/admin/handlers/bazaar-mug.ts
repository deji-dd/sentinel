import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../../../lib/db-client.js";
import { syncBazaarMugCronSchedule } from "../../../../lib/cron-schedule-registry.js";
import { logGuildAction } from "../../../../lib/guild-logger.js";

export type ConfigInteraction =
  | StringSelectMenuInteraction
  | ButtonInteraction
  | ChannelSelectMenuInteraction
  | RoleSelectMenuInteraction
  | ModalSubmitInteraction;

function getConfigSessionUserId(
  footerText?: string,
  defaultUserId?: string,
): string {
  if (!footerText) return defaultUserId || "";
  const match = footerText.match(
    /Config Session:\s*(?:@?[^\s(]+\s*\()?(\d+)\)?/,
  );
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

async function getOrCreateBazaarMugConfig(guildId: string) {
  let config = await db
    .selectFrom(TABLE_NAMES.BAZAAR_MUG_CONFIG)
    .selectAll()
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  if (!config) {
    await db
      .insertInto(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .values({
        guild_id: guildId,
        is_enabled: 0,
        min_bazaar_drop_threshold: 10000000,
        min_offline_time_minutes: 0,
        target_player_ids_json: JSON.stringify([]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    config = await db
      .selectFrom(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();
  }
  return config;
}

export async function handleShowBazaarMugSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .select("enabled_modules")
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    let enabledModules: string[] = [];
    if (guildConfig?.enabled_modules) {
      try {
        const parsed = JSON.parse(guildConfig.enabled_modules);
        enabledModules = Array.isArray(parsed) ? parsed : [];
      } catch {
        enabledModules = [];
      }
    }

    if (!enabledModules.includes("bazaar_mug")) {
      const disabledEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Bazaar Mug Watcher Disabled")
        .setDescription(
          "This guild has not enabled the Bazaar Mug Watcher module yet. Use personal admin module management to enable it first.",
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
      .setTitle("Bazaar Mug Watcher Settings")
      .setDescription(
        "Configure the live bazaar mug alert scanner, notification route, threshold, and watched targets.",
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const select = new StringSelectMenuBuilder()
      .setCustomId("config_bazaar_mug_setting_select")
      .setPlaceholder("Select a setting to edit...")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Toggle Watcher Status")
          .setValue("toggle_watcher")
          .setDescription("Enable or disable the live bazaar checker loop"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Notification Channel")
          .setValue("set_channel")
          .setDescription(
            "Channel where item drop and online alerts are dispatched",
          ),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Mention Role")
          .setValue("set_role")
          .setDescription("Role pinged when a high value drop alert triggers"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Minimum Drop Threshold")
          .setValue("set_threshold")
          .setDescription(
            "Minimum bazaar drop value to trigger a discord alert",
          ),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Minimum Offline Time")
          .setValue("set_min_offline")
          .setDescription(
            "Minimum minutes a target must be offline/idle before alerting",
          ),
        new StringSelectMenuOptionBuilder()
          .setLabel("Manage Player Watchlist")
          .setValue("manage_watchlist")
          .setDescription("List of custom player IDs to monitor manually"),
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
    console.error("Error showing bazaar mug watcher settings:", error);
  }
}

export async function handleBazaarMugSettingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    const selected = interaction.values[0];
    if (selected === "toggle_watcher") {
      await handleBazaarMugToggle(interaction);
    } else if (selected === "set_channel") {
      await handleBazaarMugSetChannel(interaction);
    } else if (selected === "set_role") {
      await handleShowBazaarMugRoleSettings(interaction);
    } else if (selected === "set_threshold") {
      await handleShowBazaarMugThresholdSettings(interaction);
    } else if (selected === "set_min_offline") {
      await handleShowBazaarMugMinOfflineSettings(interaction);
    } else if (selected === "manage_watchlist") {
      await handleShowBazaarMugWatchlistSettings(interaction);
    }
  } catch (error) {
    console.error("Error in handleBazaarMugSettingSelect:", error);
  }
}

export async function handleBazaarMugToggle(
  interaction: ConfigInteraction,
): Promise<void> {
  try {
    if ("deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getOrCreateBazaarMugConfig(guildId);
    const nextStatus = config.is_enabled ? 0 : 1;

    await db
      .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .set({
        is_enabled: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Bazaar Watcher Status Toggled",
      description: `<@${interaction.user.id}> toggled Bazaar Mug Watcher to **${
        nextStatus ? "Enabled" : "Disabled"
      }**.`,
    });

    await syncBazaarMugCronSchedule(guildId, interaction.client);

    await handleShowBazaarMugSettings(interaction, true);
  } catch (error) {
    console.error("Error toggling bazaar watcher status:", error);
  }
}

export async function handleBazaarMugSetChannel(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getOrCreateBazaarMugConfig(guildId);
    const currentChannel = config.notification_channel_id
      ? `<#${config.notification_channel_id}>`
      : "Not configured";

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Select Notification Channel")
      .setDescription(
        `Choose the text channel where all bazaar mug alerts will be posted.\n\n**Current Channel:** ${currentChannel}`,
      );

    const channelSelect =
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("bazaar_mug_channel_select")
          .setPlaceholder("Select a text channel")
          .addChannelTypes(ChannelType.GuildText),
      );

    const clearBtn = new ButtonBuilder()
      .setCustomId("bazaar_mug_clear_channel_btn")
      .setLabel("Clear Channel")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!config.notification_channel_id);

    const backBtn = new ButtonBuilder()
      .setCustomId("bazaar_mug_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      clearBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [channelSelect, row],
    });
  } catch (error) {
    console.error("Error showing channel select subpage:", error);
  }
}

export async function handleBazaarMugChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const channelId = interaction.values[0];
    if (!guildId || !channelId) return;

    await db
      .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .set({
        notification_channel_id: channelId,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Bazaar Watcher Channel Updated",
      description: `<@${interaction.user.id}> set notification channel to <#${channelId}>.`,
    });

    await syncBazaarMugCronSchedule(guildId, interaction.client);

    await handleShowBazaarMugSettings(interaction, true);
  } catch (error) {
    console.error("Error setting notification channel:", error);
  }
}

export async function handleBazaarMugClearChannelBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    await db
      .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .set({
        notification_channel_id: null,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Bazaar Watcher Channel Cleared",
      description: `<@${interaction.user.id}> cleared the notification channel.`,
    });

    await syncBazaarMugCronSchedule(guildId, interaction.client);

    await handleShowBazaarMugSettings(interaction, true);
  } catch (error) {
    console.error("Error clearing channel:", error);
  }
}

export async function handleShowBazaarMugRoleSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getOrCreateBazaarMugConfig(guildId);
    const roleText = config.ping_role_id
      ? `<@&${config.ping_role_id}>`
      : "None configured";

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Select Mention Role")
      .setDescription(
        `Select the role pinged when drop notifications are dispatched.\n\n` +
          `**Current Role:** ${roleText}`,
      );

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId("bazaar_mug_role_select")
      .setPlaceholder("Select a role...")
      .setMinValues(0)
      .setMaxValues(1);

    if (config.ping_role_id) {
      roleSelect.setDefaultRoles([config.ping_role_id]);
    }

    const clearBtn = new ButtonBuilder()
      .setCustomId("bazaar_mug_clear_role_btn")
      .setLabel("Clear Role")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!config.ping_role_id);

    const backBtn = new ButtonBuilder()
      .setCustomId("bazaar_mug_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const rowSelect =
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect);
    const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
      clearBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [rowSelect, rowBtn],
    });
  } catch (error) {
    console.error("Error showing role selector:", error);
  }
}

export async function handleBazaarMugRoleSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const roleId = interaction.values[0] || null;
    if (!guildId) return;

    await db
      .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .set({
        ping_role_id: roleId,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Bazaar Watcher Role Updated",
      description: `<@${interaction.user.id}> updated notification role to ${
        roleId ? `<@&${roleId}>` : "None"
      }.`,
    });

    await syncBazaarMugCronSchedule(guildId, interaction.client);

    await handleShowBazaarMugSettings(interaction, true);
  } catch (error) {
    console.error("Error updating bazaar mug role:", error);
  }
}

export async function handleBazaarMugClearRoleBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    await db
      .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .set({
        ping_role_id: null,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Bazaar Watcher Role Cleared",
      description: `<@${interaction.user.id}> cleared the notification ping role.`,
    });

    await syncBazaarMugCronSchedule(guildId, interaction.client);

    await handleShowBazaarMugSettings(interaction, true);
  } catch (error) {
    console.error("Error clearing bazaar role:", error);
  }
}

export async function handleShowBazaarMugThresholdSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getOrCreateBazaarMugConfig(guildId);
    const threshold = config.min_bazaar_drop_threshold
      ? `$${config.min_bazaar_drop_threshold.toLocaleString()}`
      : "$10,000,000";

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Minimum Bazaar Drop Threshold")
      .setDescription(
        "Specify the minimum item value drop in a target's bazaar to trigger alerts.\n\n" +
          `**Current Threshold:** \`${threshold}\``,
      );

    const editBtn = new ButtonBuilder()
      .setCustomId("bazaar_mug_set_threshold_btn")
      .setLabel("Edit Threshold")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("bazaar_mug_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      editBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error showing threshold subpage:", error);
  }
}

export async function handleBazaarMugSetThresholdBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getOrCreateBazaarMugConfig(guildId);

    const modal = new ModalBuilder()
      .setCustomId("bazaar_mug_threshold_modal")
      .setTitle("Edit Minimum Drop Threshold");

    const input = new TextInputBuilder()
      .setCustomId("threshold_input")
      .setLabel("Minimum Threshold (in Dollars)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 10000000")
      .setRequired(true)
      .setValue(String(config.min_bazaar_drop_threshold));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error opening threshold modal:", error);
  }
}

export async function handleBazaarMugThresholdModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const val = interaction.fields.getTextInputValue("threshold_input").trim();
    const parsed = parseInt(val, 10);

    if (isNaN(parsed) || parsed < 1) {
      return;
    }

    await db
      .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .set({
        min_bazaar_drop_threshold: parsed,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Bazaar Watcher Threshold Updated",
      description: `<@${interaction.user.id}> set minimum bazaar drop threshold to **$${parsed.toLocaleString()}**.`,
    });

    await syncBazaarMugCronSchedule(guildId, interaction.client);

    await handleShowBazaarMugSettings(interaction, true);
  } catch (error) {
    console.error("Error saving threshold modal:", error);
  }
}

export async function handleShowBazaarMugWatchlistSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getOrCreateBazaarMugConfig(guildId);
    const watchlist = parseTextArray(config.target_player_ids_json);
    const displayList =
      watchlist.length > 0 ? watchlist.join(", ") : "None configured";

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Manage Player Watchlist")
      .setDescription(
        "Configure the list of Torn Player IDs you want to check for bazaar items. Separate player IDs with commas.\n\n" +
          `**Current Monitored Players:** \`${displayList}\``,
      );

    const editBtn = new ButtonBuilder()
      .setCustomId("bazaar_mug_edit_watchlist_btn")
      .setLabel("Edit Watchlist")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("bazaar_mug_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      editBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error showing watchlist subpage:", error);
  }
}

export async function handleBazaarMugEditWatchlistBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getOrCreateBazaarMugConfig(guildId);
    const watchlist = parseTextArray(config.target_player_ids_json);
    const currentValue = watchlist.join(", ");

    const modal = new ModalBuilder()
      .setCustomId("bazaar_mug_watchlist_modal")
      .setTitle("Edit Player Watchlist");

    const input = new TextInputBuilder()
      .setCustomId("watchlist_input")
      .setLabel("Player IDs (comma-separated)")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("e.g. 1234, 5678")
      .setRequired(false)
      .setValue(currentValue);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error opening watchlist modal:", error);
  }
}

export async function handleBazaarMugWatchlistModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const value = interaction.fields
      .getTextInputValue("watchlist_input")
      .trim();
    const playerIds = value
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && /^\d+$/.test(p));

    await db
      .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .set({
        target_player_ids_json: JSON.stringify(playerIds),
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Bazaar Watcher Watchlist Updated",
      description: `<@${interaction.user.id}> updated player watchlist to: \`${
        playerIds.length > 0 ? playerIds.join(", ") : "None"
      }\`.`,
    });

    await syncBazaarMugCronSchedule(guildId, interaction.client);

    await handleShowBazaarMugWatchlistSettings(interaction, true);
  } catch (error) {
    console.error("Error saving watchlist modal:", error);
  }
}

export async function handleShowBazaarMugMinOfflineSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getOrCreateBazaarMugConfig(guildId);
    const minOffline = config.min_offline_time_minutes ?? 0;
    const minOfflineText = `${minOffline} minute${minOffline === 1 ? "" : "s"}`;

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Minimum Offline Time")
      .setDescription(
        "Specify the minimum time a player must be offline or idle before they are monitored/alerted. This helps avoid false alerts when players briefly log off.\n\n" +
          `**Current Threshold:** \`${minOfflineText}\``,
      )
      .setFooter({ text: "Sentinel" })
      .setTimestamp();

    const editBtn = new ButtonBuilder()
      .setCustomId("bazaar_mug_set_min_offline_btn")
      .setLabel("Edit Threshold")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("bazaar_mug_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      editBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error showing min offline subpage:", error);
  }
}

export async function handleBazaarMugSetMinOfflineBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getOrCreateBazaarMugConfig(guildId);

    const modal = new ModalBuilder()
      .setCustomId("bazaar_mug_min_offline_modal")
      .setTitle("Edit Minimum Offline Time");

    const input = new TextInputBuilder()
      .setCustomId("min_offline_input")
      .setLabel("Minimum Offline Time (in Minutes)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 5")
      .setRequired(true)
      .setValue(String(config.min_offline_time_minutes ?? 0));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error opening min offline modal:", error);
  }
}

export async function handleBazaarMugMinOfflineModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const val = interaction.fields.getTextInputValue("min_offline_input").trim();
    const parsed = parseInt(val, 10);

    if (isNaN(parsed) || parsed < 0) {
      return;
    }

    await db
      .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .set({
        min_offline_time_minutes: parsed,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Bazaar Watcher Min Offline Updated",
      description: `<@${interaction.user.id}> set minimum offline time to **${parsed} minute${parsed === 1 ? "" : "s"}**.`,
    });

    await syncBazaarMugCronSchedule(guildId, interaction.client);

    await handleShowBazaarMugSettings(interaction, true);
  } catch (error) {
    console.error("Error saving min offline modal:", error);
  }
}
