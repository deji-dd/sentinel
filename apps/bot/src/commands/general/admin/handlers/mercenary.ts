/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { randomUUID } from "crypto";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../../../lib/db-client.js";
import { getPrimaryGuildApiKey } from "../../../../lib/guild-api-keys.js";
import { validateAndFetchFactionDetails } from "../../../../lib/faction-utils.js";
import { postContractReport } from "../../../../lib/mercenary-reporter.js";
import { ensureMercRegistrationPanel } from "../../../../lib/mercenary-interactions.js";
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

async function getOrCreateMercenaryConfig(guildId: string) {
  let config = await db
    .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
    .selectAll()
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  if (!config) {
    await db
      .insertInto(TABLE_NAMES.MERCENARY_CONFIG)
      .values({
        guild_id: guildId,
        is_enabled: 1,
        dibs_enabled: 1,
        default_target_scope: "offline_and_idle",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    config = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();
  }
  return config;
}

async function getOrCreateMercenaryDibsConfig(guildId: string) {
  let config = await db
    .selectFrom(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
    .selectAll()
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  if (!config) {
    await db
      .insertInto(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
      .values({
        guild_id: guildId,
        is_enabled: 1,
        max_active_dibs_per_person: 5,
        dibs_remaining_minutes: 15,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    config = await db
      .selectFrom(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();
  }
  return config;
}

export async function handleShowMercenarySettings(
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

    // Parse enabled_modules
    let enabledModules: string[] = [];
    if (guildConfig?.enabled_modules) {
      try {
        const parsed = JSON.parse(guildConfig.enabled_modules);
        enabledModules = Array.isArray(parsed) ? parsed : [];
      } catch {
        enabledModules = [];
      }
    }

    if (!enabledModules.includes("mercenary")) {
      const disabledEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Mercenary Module Disabled")
        .setDescription(
          "This guild has not enabled the mercenary module yet. Use personal admin module management to enable it first.",
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
      .setTitle("Mercenary Settings")
      .setDescription(
        "Manage mercenary registration, alert routing channels, dibs timers, and active contracts.",
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const select = new StringSelectMenuBuilder()
      .setCustomId("config_mercenary_setting_select")
      .setPlaceholder("Select a setting to edit...")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Announcement Channel")
          .setValue("set_announcement_channel")
          .setDescription("Channel where new contracts are posted"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Payout Channel")
          .setValue("set_payout_channel")
          .setDescription("Channel where payouts are logged"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Registration Channel")
          .setValue("set_registration_channel")
          .setDescription(
            "Channel containing the verification registration panel",
          ),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Hit Posting Channel")
          .setValue("set_hit_post_channel")
          .setDescription("Channel where target hit alert logs are sent"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Audit Channel")
          .setValue("set_audit_channel")
          .setDescription("Channel where configuration changes are audited"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Mercenary Roles")
          .setValue("set_roles")
          .setDescription("Roles assigned to users who verify as a mercenary"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Configure Dibs System")
          .setValue("config_dibs")
          .setDescription(
            "Toggle dibs, set max active limits and expiration timers",
          ),
        new StringSelectMenuOptionBuilder()
          .setLabel("Contract Management")
          .setValue("manage_contracts")
          .setDescription(
            "View active contracts, complete them, or launch a new contract",
          ),
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
    console.error("Error showing mercenary settings:", error);
  }
}

export async function handleMercenarySettingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    const selected = interaction.values[0];
    if (selected === "set_announcement_channel") {
      await handleMercenarySetChannel(interaction, "announcement");
    } else if (selected === "set_payout_channel") {
      await handleMercenarySetChannel(interaction, "payout");
    } else if (selected === "set_registration_channel") {
      await handleMercenarySetChannel(interaction, "registration");
    } else if (selected === "set_hit_post_channel") {
      await handleMercenarySetChannel(interaction, "hit_post");
    } else if (selected === "set_audit_channel") {
      await handleMercenarySetChannel(interaction, "audit");
    } else if (selected === "set_roles") {
      await handleShowMercenaryRolesSettings(interaction);
    } else if (selected === "config_dibs") {
      await handleShowDibsSettings(interaction);
    } else if (selected === "manage_contracts") {
      await handleShowContractSettings(interaction);
    }
  } catch (error) {
    console.error("Error in handleMercenarySettingSelect:", error);
  }
}

export async function handleMercenarySetChannel(
  interaction: ConfigInteraction,
  type: "announcement" | "payout" | "registration" | "hit_post" | "audit",
): Promise<void> {
  try {
    if ("deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getOrCreateMercenaryConfig(guildId);

    let currentChannelId: string | null = null;
    let customId = "";
    let title = "";
    let description = "";
    let clearCustomId = "";

    if (type === "announcement") {
      currentChannelId = config.contract_announcement_channel_id;
      customId = "merc_announcement_channel_select";
      title = "Set Announcement Channel";
      description =
        "Choose the channel where new mercenary contracts will be announced.";
      clearCustomId = "merc_clear_announcement_channel_btn";
    } else if (type === "payout") {
      currentChannelId = config.payout_channel_id;
      customId = "merc_payout_channel_select";
      title = "Set Payout Channel";
      description =
        "Choose the channel where mercenary payouts will be logged.";
      clearCustomId = "merc_clear_payout_channel_btn";
    } else if (type === "registration") {
      currentChannelId = config.merc_registration_channel_id;
      customId = "merc_registration_channel_select";
      title = "Set Registration Channel";
      description =
        "Choose the channel containing the mercenary verification registration panel.";
      clearCustomId = "merc_clear_registration_channel_btn";
    } else if (type === "hit_post") {
      currentChannelId = config.hit_post_channel_id;
      customId = "merc_hit_post_channel_select";
      title = "Set Hit Posting Channel";
      description =
        "Choose the channel where live target hit posts will be logged.";
      clearCustomId = "merc_clear_hit_post_channel_btn";
    } else if (type === "audit") {
      currentChannelId = config.audit_channel_id;
      customId = "merc_audit_channel_select";
      title = "Set Audit Channel";
      description =
        "Choose the channel where mercenary configuration changes will be logged.";
      clearCustomId = "merc_clear_audit_channel_btn";
    }

    const currentChannelText = currentChannelId
      ? `<#${currentChannelId}>`
      : "Not configured";

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle(title)
      .setDescription(
        `${description}\n\n**Current Channel:** ${currentChannelText}`,
      );

    const channelSelect =
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder("Select a text channel")
          .addChannelTypes(ChannelType.GuildText),
      );

    const clearBtn = new ButtonBuilder()
      .setCustomId(clearCustomId)
      .setLabel("Clear Channel")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!currentChannelId);

    const backBtn = new ButtonBuilder()
      .setCustomId("mercenary_settings_show")
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
    console.error("Error setting mercenary channel:", error);
  }
}

async function handleChannelUpdate(
  interaction: ChannelSelectMenuInteraction | ButtonInteraction,
  column:
    | "contract_announcement_channel_id"
    | "payout_channel_id"
    | "merc_registration_channel_id"
    | "hit_post_channel_id"
    | "audit_channel_id",
  channelId: string | null,
  logLabel: string,
): Promise<void> {
  try {
    if ("deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    if (column === "merc_registration_channel_id") {
      const currentConfig = await getOrCreateMercenaryConfig(guildId);
      const oldChannelId = currentConfig.merc_registration_channel_id;
      const oldMessageId = currentConfig.merc_registration_message_id;

      // Deleting registration message from previous channel if changing
      if (oldChannelId && oldMessageId && oldChannelId !== channelId) {
        try {
          const oldChan = await interaction.client.channels.fetch(oldChannelId);
          if (oldChan?.isTextBased()) {
            const oldMsg = await oldChan.messages.fetch(oldMessageId);
            if (oldMsg) await oldMsg.delete();
          }
        } catch (e) {
          console.warn(
            "Failed to delete old mercenary registration message:",
            e,
          );
        }
      }

      await db
        .updateTable(TABLE_NAMES.MERCENARY_CONFIG)
        .set({
          merc_registration_channel_id: channelId,
          merc_registration_message_id: null,
          updated_at: new Date().toISOString(),
        })
        .where("guild_id", "=", guildId)
        .execute();

      // Post the panel in the new channel if set
      if (channelId) {
        await ensureMercRegistrationPanel(interaction.client, guildId);
      }
    } else {
      await db
        .updateTable(TABLE_NAMES.MERCENARY_CONFIG)
        .set({
          [column]: channelId,
          updated_at: new Date().toISOString(),
        })
        .where("guild_id", "=", guildId)
        .execute();
    }

    await logGuildAction(guildId, interaction.client, {
      title: "Mercenary Configuration Updated",
      description: `<@${interaction.user.id}> updated **${logLabel}** to ${
        channelId ? `<#${channelId}>` : "Not configured"
      }.`,
    });

    await handleShowMercenarySettings(interaction, true);
  } catch (error) {
    console.error(`Error updating channel for ${column}:`, error);
  }
}

export async function handleMercenaryAnnouncementChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  const channelId = interaction.values[0];
  await handleChannelUpdate(
    interaction,
    "contract_announcement_channel_id",
    channelId,
    "Announcement Channel",
  );
}

export async function handleMercenaryClearAnnouncementChannelBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  await handleChannelUpdate(
    interaction,
    "contract_announcement_channel_id",
    null,
    "Announcement Channel",
  );
}

export async function handleMercenaryPayoutChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  const channelId = interaction.values[0];
  await handleChannelUpdate(
    interaction,
    "payout_channel_id",
    channelId,
    "Payout Channel",
  );
}

export async function handleMercenaryClearPayoutChannelBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  await handleChannelUpdate(
    interaction,
    "payout_channel_id",
    null,
    "Payout Channel",
  );
}

export async function handleMercenaryRegistrationChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  const channelId = interaction.values[0];
  await handleChannelUpdate(
    interaction,
    "merc_registration_channel_id",
    channelId,
    "Registration Channel",
  );
}

export async function handleMercenaryClearRegistrationChannelBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  await handleChannelUpdate(
    interaction,
    "merc_registration_channel_id",
    null,
    "Registration Channel",
  );
}

export async function handleMercenaryHitPostChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  const channelId = interaction.values[0];
  await handleChannelUpdate(
    interaction,
    "hit_post_channel_id",
    channelId,
    "Hit Posting Channel",
  );
}

export async function handleMercenaryClearHitPostChannelBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  await handleChannelUpdate(
    interaction,
    "hit_post_channel_id",
    null,
    "Hit Posting Channel",
  );
}

export async function handleMercenaryAuditChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  const channelId = interaction.values[0];
  await handleChannelUpdate(
    interaction,
    "audit_channel_id",
    channelId,
    "Audit Channel",
  );
}

export async function handleMercenaryClearAuditChannelBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  await handleChannelUpdate(
    interaction,
    "audit_channel_id",
    null,
    "Audit Channel",
  );
}

export async function handleShowMercenaryRolesSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getOrCreateMercenaryConfig(guildId);
    const existingRoles = parseTextArray(config?.merc_role_ids_json);
    const rolesMentions =
      existingRoles.length > 0
        ? existingRoles.map((r) => `<@&${r}>`).join(", ")
        : "None configured";

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Set Mercenary Roles")
      .setDescription(
        `Select the roles assigned to users who verify in the mercenary registration system.\n\n` +
          `**Current Roles:** ${rolesMentions}`,
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId("merc_roles_select")
      .setPlaceholder("Select roles...")
      .setMinValues(0)
      .setMaxValues(10);

    if (existingRoles.length > 0) {
      roleSelect.setDefaultRoles(existingRoles);
    }

    const backBtn = new ButtonBuilder()
      .setCustomId("mercenary_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const rowSelect =
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect);
    const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [rowSelect, rowBtn],
    });
  } catch (error) {
    console.error("Error showing mercenary roles page:", error);
  }
}

export async function handleMercenaryRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const roleIds = interaction.values;

    await db
      .updateTable(TABLE_NAMES.MERCENARY_CONFIG)
      .set({
        merc_role_ids_json: JSON.stringify(roleIds),
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    const roleMentions =
      roleIds.length > 0
        ? roleIds.map((r) => `<@&${r}>`).join(", ")
        : "None configured";

    await logGuildAction(guildId, interaction.client, {
      title: "Mercenary Roles Updated",
      description: `<@${interaction.user.id}> updated mercenary roles to: ${roleMentions}.`,
    });

    await handleShowMercenarySettings(interaction, true);
  } catch (error) {
    console.error("Error setting mercenary roles:", error);
  }
}

export async function handleShowDibsSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const dibsConfig = await getOrCreateMercenaryDibsConfig(guildId);

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    const dibsStatus = dibsConfig.is_enabled ? "Enabled" : "Disabled";

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Configure Dibs System")
      .setDescription(
        "Manage the target reservation (dibs) system settings.\n\n" +
          `• **Dibs Status**: \`${dibsStatus}\` (Updates both configuration tables)\n` +
          `• **Max Active Dibs Per Person**: \`${dibsConfig.max_active_dibs_per_person}\`\n` +
          `• **Dibs Remaining Time**: \`${dibsConfig.dibs_remaining_minutes} minutes\``,
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const toggleBtn = new ButtonBuilder()
      .setCustomId("merc_toggle_dibs_btn")
      .setLabel(dibsConfig.is_enabled ? "Disable Dibs" : "Enable Dibs")
      .setStyle(
        dibsConfig.is_enabled ? ButtonStyle.Danger : ButtonStyle.Success,
      );

    const setMaxBtn = new ButtonBuilder()
      .setCustomId("merc_set_max_dibs_btn")
      .setLabel("Set Max Active Dibs")
      .setStyle(ButtonStyle.Primary);

    const setTimeBtn = new ButtonBuilder()
      .setCustomId("merc_set_dibs_time_btn")
      .setLabel("Set Expiration Timer")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("mercenary_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      toggleBtn,
      setMaxBtn,
      setTimeBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error showing dibs settings:", error);
  }
}

export async function handleMercenaryToggleDibsBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const dibsConfig = await getOrCreateMercenaryDibsConfig(guildId);
    const nextStatus = dibsConfig.is_enabled ? 0 : 1;

    await db
      .updateTable(TABLE_NAMES.MERCENARY_CONFIG)
      .set({
        dibs_enabled: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    await db
      .updateTable(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
      .set({
        is_enabled: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Mercenary Dibs Toggled",
      description: `<@${interaction.user.id}> toggled Dibs status to **${
        nextStatus ? "Enabled" : "Disabled"
      }**.`,
    });

    await handleShowDibsSettings(interaction, true);
  } catch (error) {
    console.error("Error toggling dibs:", error);
  }
}

export async function handleMercenarySetMaxDibsBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const dibsConfig = await getOrCreateMercenaryDibsConfig(guildId);

    const modal = new ModalBuilder()
      .setCustomId("merc_max_dibs_modal")
      .setTitle("Max Active Dibs Per Person");

    const input = new TextInputBuilder()
      .setCustomId("max_dibs_input")
      .setLabel("Max Active Dibs limit")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 5")
      .setRequired(true)
      .setValue(String(dibsConfig.max_active_dibs_per_person));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error opening max active dibs modal:", error);
  }
}

export async function handleMercenaryMaxDibsModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const val = interaction.fields.getTextInputValue("max_dibs_input").trim();
    const parsed = parseInt(val, 10);

    if (isNaN(parsed) || parsed < 1) {
      // Ignore or default to 5
      return;
    }

    await db
      .updateTable(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
      .set({
        max_active_dibs_per_person: parsed,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Mercenary Max Dibs Updated",
      description: `<@${interaction.user.id}> updated Max Active Dibs Limit to **${parsed}**.`,
    });

    await handleShowDibsSettings(interaction, true);
  } catch (error) {
    console.error("Error saving max dibs modal:", error);
  }
}

export async function handleMercenarySetDibsTimeBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const dibsConfig = await getOrCreateMercenaryDibsConfig(guildId);

    const modal = new ModalBuilder()
      .setCustomId("merc_dibs_time_modal")
      .setTitle("Dibs Expiration Timer");

    const input = new TextInputBuilder()
      .setCustomId("dibs_time_input")
      .setLabel("Dibs Remaining Time (in minutes)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 15")
      .setRequired(true)
      .setValue(String(dibsConfig.dibs_remaining_minutes));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error opening dibs time modal:", error);
  }
}

export async function handleMercenaryDibsTimeModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const val = interaction.fields.getTextInputValue("dibs_time_input").trim();
    const parsed = parseInt(val, 10);

    if (isNaN(parsed) || parsed < 1) {
      return;
    }

    await db
      .updateTable(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
      .set({
        dibs_remaining_minutes: parsed,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", guildId)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Mercenary Dibs Expiration Updated",
      description: `<@${interaction.user.id}> updated Dibs Expiration Timer to **${parsed} minutes**.`,
    });

    await handleShowDibsSettings(interaction, true);
  } catch (error) {
    console.error("Error saving dibs time modal:", error);
  }
}

export async function handleShowContractSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    const activeContracts = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("status", "=", "active")
      .execute();

    let description = "### Active Mercenary Contracts\n\n";
    if (activeContracts.length === 0) {
      description +=
        "_There are no active contracts for this server. Click below to create one._";
    } else {
      activeContracts.forEach((c) => {
        const payStr = c.pay_amount
          ? `${c.pay_amount.toLocaleString()} cash`
          : "None";
        description += `• **${c.title}** (Faction ID: \`${c.faction_id}\`, Payout: \`${payStr}\`, Target: \`${c.target_scope}\`)\n`;
      });
      description +=
        "\nTo complete/finish a contract and post its payout details report, select it below.";
    }

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Mercenary Contract Management")
      .setDescription(description)
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const components: any[] = [];

    if (activeContracts.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId("config_merc_close_contract_select")
        .setPlaceholder("Select a contract to close/complete...")
        .addOptions(
          activeContracts.map((c) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(c.title.substring(0, 100))
              .setValue(String(c.id)),
          ),
        );
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      );
    }

    const createBtn = new ButtonBuilder()
      .setCustomId("merc_create_contract_btn")
      .setLabel("Create Contract")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("mercenary_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      createBtn,
      backBtn,
    );

    components.push(buttonRow);

    await interaction.editReply({
      embeds: [embed],
      components,
    });
  } catch (error) {
    console.error("Error showing contract settings dashboard:", error);
  }
}

export async function handleMercenaryCloseContractSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const contractId = interaction.values[0];
    if (!guildId || !contractId) return;

    const contract = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
      .selectAll()
      .where("id", "=", contractId)
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!contract) return;

    await db
      .updateTable(TABLE_NAMES.MERCENARY_CONTRACTS)
      .set({
        status: "completed",
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where("id", "=", contractId)
      .where("guild_id", "=", guildId)
      .execute();

    try {
      await postContractReport(interaction.client, contractId, guildId);
    } catch (reportError) {
      console.error("Failed to post completion report:", reportError);
    }

    await logGuildAction(guildId, interaction.client, {
      title: "Mercenary Contract Completed",
      description: `<@${interaction.user.id}> closed/completed contract: **${contract.title}**.`,
    });

    await handleShowContractSettings(interaction, true);
  } catch (error) {
    console.error("Error closing contract:", error);
  }
}

export async function handleMercenaryCreateContractBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const modal = new ModalBuilder()
      .setCustomId("merc_create_contract_modal")
      .setTitle("Create Mercenary Contract");

    const titleInput = new TextInputBuilder()
      .setCustomId("title_input")
      .setLabel("Contract Title")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. Faction War on ABC")
      .setRequired(true);

    const factionInput = new TextInputBuilder()
      .setCustomId("faction_input")
      .setLabel("Target Faction ID")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 1234")
      .setRequired(true);

    const payInput = new TextInputBuilder()
      .setCustomId("pay_input")
      .setLabel("Payout Amount")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 10000000 (Optional)")
      .setRequired(false);

    const scopeInput = new TextInputBuilder()
      .setCustomId("scope_input")
      .setLabel("Scope (offline_and_idle / offline / all)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("offline_and_idle")
      .setValue("offline_and_idle")
      .setRequired(false);

    const levelInput = new TextInputBuilder()
      .setCustomId("level_input")
      .setLabel("Max Target Level")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 100 (Optional)")
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(factionInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(payInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(scopeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(levelInput),
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error opening create contract modal:", error);
  }
}

export async function handleMercenaryCreateContractModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const title = interaction.fields.getTextInputValue("title_input").trim();
    const factionIdStr = interaction.fields
      .getTextInputValue("faction_input")
      .trim();
    const payStr = interaction.fields.getTextInputValue("pay_input").trim();
    const scope = interaction.fields.getTextInputValue("scope_input").trim();
    const levelStr = interaction.fields.getTextInputValue("level_input").trim();

    if (!title) {
      await interaction.editReply("Contract title is required.");
      return;
    }

    const factionId = parseInt(factionIdStr, 10);
    if (isNaN(factionId) || factionId <= 0) {
      await interaction.editReply("Please provide a valid numeric Faction ID.");
      return;
    }

    const apiKey = await getPrimaryGuildApiKey(guildId);
    if (!apiKey) {
      await interaction.editReply(
        "No primary Torn API key configured. Add one in Admin Config first.",
      );
      return;
    }

    const faction = await validateAndFetchFactionDetails(factionId, apiKey);
    if (!faction) {
      await interaction.editReply(
        "Faction verification failed. Check the faction_id and your API key scope.",
      );
      return;
    }

    const payAmount = payStr ? parseInt(payStr, 10) : 0;
    const maxLevel = levelStr ? parseInt(levelStr, 10) : null;

    const contractId = randomUUID();

    await db
      .insertInto(TABLE_NAMES.MERCENARY_CONTRACTS)
      .values({
        id: contractId,
        guild_id: guildId,
        title: title,
        description: null,
        contract_type: "hosp",
        status: "active",
        pay_amount: isNaN(payAmount) ? 0 : payAmount,
        pay_currency: "cash",
        pay_terms: null,
        start_at: new Date().toISOString(),
        ends_at: null,
        created_by: interaction.user.id,
        updated_at: new Date().toISOString(),
        faction_id: factionId,
        faction_name: faction.name,
        target_scope: scope || "offline_and_idle",
        idle_minutes: null,
        auto_finish_on_war_end: 0,
        min_level: null,
        max_level: isNaN(Number(maxLevel)) ? null : maxLevel,
        require_faction_no_active_war: 0,
        require_faction_no_upcoming_war: 0,
      })
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Mercenary Contract Created",
      description: `<@${interaction.user.id}> created new contract **${title}** for faction **${faction.name} [${factionId}]**.`,
    });

    await interaction.editReply(`Contract successfully created.`);

    // Refresh dashboard back
    await handleShowContractSettings(interaction, true);
  } catch (error) {
    console.error("Error creating mercenary contract from modal:", error);
    await interaction.editReply("Failed to create mercenary contract.");
  }
}
