/**
 * Interaction Handlers Router Module
 * Routes and handles buttons, modals, and select menus
 */

import {
  Client,
  type Interaction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type ChannelSelectMenuInteraction,
} from "discord.js";
import * as configCommand from "../commands/general/admin/config.js";
import * as adminCommand from "../commands/general/admin/admin.js";
import * as assistCommand from "../commands/general/assist/assist.js";
import * as ttSelectorCommand from "../commands/general/territories/tt-selector.js";
import * as mercenaryInteractions from "./mercenary-interactions.js";
import * as verifyHandlers from "../commands/general/admin/handlers/verify.js";

type ButtonHandler = (interaction: ButtonInteraction) => Promise<void>;
type ModalHandler = (interaction: ModalSubmitInteraction) => Promise<void>;
type StringSelectHandler = (
  interaction: StringSelectMenuInteraction,
) => Promise<void>;
type RoleSelectHandler = (
  interaction: RoleSelectMenuInteraction,
) => Promise<void>;
type ChannelSelectHandler = (
  interaction: ChannelSelectMenuInteraction,
) => Promise<void>;

const buttonHandlers = new Map<string, ButtonHandler>([
  ["config_back_to_menu", configCommand.handleBackToMenu],
  ["config_initialize_guild", configCommand.handleInitializeGuild],
  ["config_edit_api_keys", configCommand.handleShowApiKeys],
  ["config_add_api_key", configCommand.handleConfigAddApiKeyButton],
  ["config_back_admin_settings", configCommand.handleShowAdminSettings],
  ["revive_settings_show", configCommand.handleShowReviveSettings],
  ["revive_set_min_hosp", configCommand.handleReviveSetMinHospButton],
  ["revive_request_me", configCommand.handleReviveRequestMe],
  ["revive_request_other", configCommand.handleReviveRequestOther],
  ["assist_settings_show", configCommand.handleShowAssistSettings],
  ["merc_register_button", mercenaryInteractions.handleMercRegisterButton],
  ["merc_update_key_button", mercenaryInteractions.handleMercUpdateKeyButton],
  ["merc_unregister_button", mercenaryInteractions.handleMercUnregisterButton],
  ["admin_guild_init_modal_btn", adminCommand.handleGuildInitModalBtn],
  ["admin_back_to_main", (i) => adminCommand.handleShowMainDashboard(i)],
  ["admin_guild_modules_back_to_list", (i) => adminCommand.handleShowGuildModules(i)],
  ["admin_redeploy_confirm", adminCommand.handleRedeployConfirm],
  ["admin_backup_confirm", adminCommand.handleBackupConfirm],
  ["admin_guild_deinit_back_to_list", (i) => adminCommand.handleShowGuildDeinit(i)],
  ["config_verify_back_to_settings", (i) => verifyHandlers.handleShowVerifySettings(i)],
  ["config_verify_back_to_mappings", verifyHandlers.handleShowFactionMappings],
  ["config_verify_toggle_auto_verify_btn", verifyHandlers.handleVerifyToggleAutoVerifyBtn],
  ["config_verify_edit_nickname_btn", verifyHandlers.handleVerifyEditNicknameBtn],
  ["config_verify_add_faction_btn", verifyHandlers.handleVerifyAddFactionBtn],
  ["territories_settings_show", configCommand.handleShowTerritoriesSettings],
  ["territories_set_watched_territories_btn", configCommand.handleTerritoriesSetWatchedTerritoriesBtn],
  ["territories_set_watched_factions_btn", configCommand.handleTerritoriesSetWatchedFactionsBtn],
  ["mercenary_settings_show", configCommand.handleShowMercenarySettings],
  ["merc_toggle_dibs_btn", configCommand.handleMercenaryToggleDibsBtn],
  ["merc_set_max_dibs_btn", configCommand.handleMercenarySetMaxDibsBtn],
  ["merc_set_dibs_time_btn", configCommand.handleMercenarySetDibsTimeBtn],
  ["merc_create_contract_btn", configCommand.handleMercenaryCreateContractBtn],
  ["merc_clear_announcement_channel_btn", configCommand.handleMercenaryClearAnnouncementChannelBtn],
  ["merc_clear_payout_channel_btn", configCommand.handleMercenaryClearPayoutChannelBtn],
  ["merc_clear_registration_channel_btn", configCommand.handleMercenaryClearRegistrationChannelBtn],
  ["merc_clear_hit_post_channel_btn", configCommand.handleMercenaryClearHitPostChannelBtn],
  ["merc_clear_audit_channel_btn", configCommand.handleMercenaryClearAuditChannelBtn],
  ["bazaar_mug_settings_show", configCommand.handleShowBazaarMugSettings],
  ["bazaar_mug_set_threshold_btn", configCommand.handleBazaarMugSetThresholdBtn],
  ["bazaar_mug_set_min_offline_btn", configCommand.handleBazaarMugSetMinOfflineBtn],
  ["bazaar_mug_edit_watchlist_btn", configCommand.handleBazaarMugEditWatchlistBtn],
  ["bazaar_mug_clear_channel_btn", configCommand.handleBazaarMugClearChannelBtn],
  ["bazaar_mug_clear_role_btn", configCommand.handleBazaarMugClearRoleBtn],
  ["rr_btn_add_message", configCommand.handleReactionRolesAddMessage],
  ["rr_btn_manage_messages", configCommand.handleShowManageExistingMessages],
  ["rr_btn_main_settings", configCommand.handleShowReactionRolesSettings],
]);

const buttonPrefixHandlers: Array<{ prefix: string; handler: ButtonHandler }> =
  [
    {
      prefix: "config_scaffold_",
      handler: configCommand.handleScaffoldButton,
    },
    {
      prefix: "revive_confirm_request",
      handler: configCommand.handleReviveConfirmRequest,
    },
    {
      prefix: "revive_cancel_request|",
      handler: configCommand.handleReviveCancelRequest,
    },
    {
      prefix: "revive_mark_revived|",
      handler: configCommand.handleReviveMarkRevived,
    },
    {
      prefix: "assist_config_page_prev|",
      handler: configCommand.handleAssistManagePageButton,
    },
    {
      prefix: "assist_config_page_next|",
      handler: configCommand.handleAssistManagePageButton,
    },
    {
      prefix: "assist_config_manage_back|",
      handler: configCommand.handleAssistManageBackButton,
    },
    {
      prefix: "assist_manage_page_prev|",
      handler: assistCommand.handleManagePageButton,
    },
    {
      prefix: "assist_manage_page_next|",
      handler: assistCommand.handleManagePageButton,
    },
    {
      prefix: "assist_manage_back|",
      handler: assistCommand.handleManageBackButton,
    },
    {
      prefix: "merc_claim_",
      handler: mercenaryInteractions.handleMercClaimButton,
    },
    {
      prefix: "merc_attack_",
      handler: mercenaryInteractions.handleMercAttackButton,
    },
    {
      prefix: "merc_page_prev_",
      handler: mercenaryInteractions.handleMercPageButton,
    },
    {
      prefix: "merc_page_next_",
      handler: mercenaryInteractions.handleMercPageButton,
    },
    {
      prefix: "bazaar_mug_page_prev|",
      handler: async (interaction) => {
        const guildId = interaction.customId.split("|")[1];
        const { activeWatchers } = await import("./bazaar-mug-watcher.js");
        const watcher = activeWatchers.get(guildId);
        if (watcher) {
          await watcher.changePage(interaction, -1);
        } else {
          await interaction.reply({ content: "Watcher is not active for this guild.", ephemeral: true });
        }
      }
    },
    {
      prefix: "bazaar_mug_page_next|",
      handler: async (interaction) => {
        const guildId = interaction.customId.split("|")[1];
        const { activeWatchers } = await import("./bazaar-mug-watcher.js");
        const watcher = activeWatchers.get(guildId);
        if (watcher) {
          await watcher.changePage(interaction, 1);
        } else {
          await interaction.reply({ content: "Watcher is not active for this guild.", ephemeral: true });
        }
      }
    },
    {
      prefix: "energy_gains_range|",
      handler: async (interaction) => {
        const days = parseInt(interaction.customId.split("|")[1], 10);
        if (isNaN(days)) return;

        const userId = process.env.SENTINEL_USER_ID;
        if (!userId) {
          await interaction.reply({ content: "Authorized user ID not configured.", ephemeral: true });
          return;
        }

        // Update database
        const { db } = await import("./db-client.js");
        const { TABLE_NAMES } = await import("@sentinel/shared");
        await db
          .updateTable(TABLE_NAMES.PERSONAL_SETTINGS)
          .set({ energy_dashboard_gains_days: days })
          .where("user_id", "=", userId)
          .execute();

        // Acknowledge interaction
        await interaction.deferUpdate();

        // Run sync
        const { performEnergyDashboardSync } = await import("../tasks/energy-dashboard-task.js");
        await performEnergyDashboardSync(interaction.client);
      }
    },
    {
      prefix: "admin_guild_deinit_confirm_only|",
      handler: adminCommand.handleGuildDeinitConfirm,
    },
    {
      prefix: "admin_guild_deinit_confirm_leave|",
      handler: adminCommand.handleGuildDeinitConfirm,
    },
    {
      prefix: "config_verify_faction_back_to_edit|",
      handler: verifyHandlers.handleVerifyFactionBackToEdit,
    },
    {
      prefix: "config_verify_mappings_page|",
      handler: verifyHandlers.handleVerifyMappingsPage,
    },
    {
      prefix: "rr_btn_fill_details|",
      handler: configCommand.handleReactionRolesFillDetails,
    },
    {
      prefix: "rr_btn_delete_msg|",
      handler: configCommand.handleReactionRoleDeleteMsgBtn,
    },
    {
      prefix: "rr_btn_skip_req_roles|",
      handler: configCommand.handleReactionRolesSkipRequiredRoles,
    },
    {
      prefix: "rr_btn_back_to_req_roles|",
      handler: configCommand.handleReactionRolesBackToRequiredRoles,
    },
    {
      prefix: "rr_btn_back_to_mapped_roles|",
      handler: configCommand.handleReactionRolesBackToMappedRoles,
    }
  ];

const modalHandlers = new Map<string, ModalHandler>([
  ["revive_min_hosp_modal", configCommand.handleReviveSetMinHospModal],
  ["revive_request_other_modal", configCommand.handleReviveRequestOtherModal],
  ["tt_selector_create_modal", ttSelectorCommand.handleModalSubmitInteraction],
  ["merc_register_modal", mercenaryInteractions.handleMercRegisterModal],
  ["config_add_api_key_modal", configCommand.handleConfigAddApiKeyModal],
  ["admin_guild_init_modal", adminCommand.handleGuildInitModalSubmit],
  ["config_verify_nickname_modal", verifyHandlers.handleVerifyNicknameModalSubmit],
  ["config_verify_add_faction_modal", verifyHandlers.handleVerifyAddFactionModalSubmit],
  ["territories_watched_territories_modal", configCommand.handleTerritoriesWatchedTerritoriesModal],
  ["territories_watched_factions_modal", configCommand.handleTerritoriesWatchedFactionsModal],
  ["merc_max_dibs_modal", configCommand.handleMercenaryMaxDibsModal],
  ["merc_dibs_time_modal", configCommand.handleMercenaryDibsTimeModal],
  ["merc_create_contract_modal", configCommand.handleMercenaryCreateContractModal],
  ["bazaar_mug_threshold_modal", configCommand.handleBazaarMugThresholdModal],
  ["bazaar_mug_min_offline_modal", configCommand.handleBazaarMugMinOfflineModal],
  ["bazaar_mug_watchlist_modal", configCommand.handleBazaarMugWatchlistModal],
]);

const stringSelectHandlers = new Map<string, StringSelectHandler>([
  ["config_view_select", configCommand.handleViewSelect],
  ["config_remove_api_key_select", configCommand.handleConfigRemoveApiKeySelect],
  ["config_admin_setting_select", configCommand.handleAdminSettingSelect],
  ["admin_dashboard_select", adminCommand.handleAdminDashboardSelect],
  ["admin_guild_init_select", adminCommand.handleGuildInitSelect],
  ["admin_guild_deinit_select", adminCommand.handleGuildDeinitSelect],
  ["admin_guild_modules_guild_select", adminCommand.handleGuildModulesGuildSelect],
  ["config_verify_setting_select", verifyHandlers.handleVerifySettingSelect],
  ["config_verify_faction_select", verifyHandlers.handleVerifyFactionSelect],
  ["config_revive_setting_select", configCommand.handleReviveSettingSelect],
  ["config_assist_setting_select", configCommand.handleAssistSettingSelect],
  ["config_territories_setting_select", configCommand.handleTerritoriesSettingSelect],
  ["config_mercenary_setting_select", configCommand.handleMercenarySettingSelect],
  ["config_merc_close_contract_select", configCommand.handleMercenaryCloseContractSelect],
  ["config_bazaar_mug_setting_select", configCommand.handleBazaarMugSettingSelect],
  ["config_reaction_roles_setting_select", configCommand.handleReactionRolesSettingSelect],
  ["rr_select_manage_msg", configCommand.handleReactionRolesSelectMessage],
]);

const stringSelectPrefixHandlers: Array<{
  prefix: string;
  handler: StringSelectHandler;
}> = [
  {
    prefix: "assist_config_user_select|",
    handler: configCommand.handleAssistManageUserSelect,
  },
  {
    prefix: "assist_config_action_select|",
    handler: configCommand.handleAssistManageActionSelect,
  },
  {
    prefix: "assist_manage_user_select|",
    handler: assistCommand.handleManageUserSelect,
  },
  {
    prefix: "assist_manage_action_select|",
    handler: assistCommand.handleManageActionSelect,
  },
  {
    prefix: "tt_selector_",
    handler: ttSelectorCommand.handleStringSelectMenuInteraction,
  },
  {
    prefix: "merc_select_target|",
    handler: mercenaryInteractions.handleMercSelectTarget,
  },
  {
    prefix: "admin_guild_modules_save_select|",
    handler: adminCommand.handleGuildModulesSaveSelect,
  },
  {
    prefix: "config_verify_faction_action_select|",
    handler: verifyHandlers.handleVerifyFactionActionSelect,
  },
];

const roleSelectHandlers = new Map<string, RoleSelectHandler>([
  ["revive_ping_role_select", configCommand.handleRevivePingRoleSelect],
  ["assist_ping_role_select", configCommand.handleAssistPingRoleSelect],
  ["assist_script_roles_select", configCommand.handleAssistScriptRolesSelect],
  ["config_verify_roles_select", verifyHandlers.handleVerifyRolesSelect],
  ["merc_roles_select", configCommand.handleMercenaryRolesSelect],
  ["bazaar_mug_role_select", configCommand.handleBazaarMugRoleSelect],
]);

const roleSelectPrefixHandlers: Array<{
  prefix: string;
  handler: RoleSelectHandler;
}> = [
  {
    prefix: "config_verify_faction_members_select|",
    handler: verifyHandlers.handleVerifyFactionMembersSelect,
  },
  {
    prefix: "config_verify_faction_leaders_select|",
    handler: verifyHandlers.handleVerifyFactionLeadersSelect,
  },
  {
    prefix: "rr_roles_select_mappings|",
    handler: configCommand.handleReactionRolesRolesSelect,
  },
  {
    prefix: "rr_roles_select_required|",
    handler: configCommand.handleReactionRolesRequiredRolesSelect,
  }
];

const channelSelectHandlers = new Map<string, ChannelSelectHandler>([
  [
    "revive_request_channel_select",
    configCommand.handleReviveRequestChannelSelect,
  ],
  [
    "revive_output_channel_select",
    configCommand.handleReviveOutputChannelSelect,
  ],
  ["assist_channel_select", configCommand.handleAssistChannelSelect],
  ["config_verify_channel_select", verifyHandlers.handleVerifyChannelSelect],
  ["territories_full_channel_select", configCommand.handleTerritoriesFullChannelSelect],
  ["territories_filtered_channel_select", configCommand.handleTerritoriesFilteredChannelSelect],
  ["merc_announcement_channel_select", configCommand.handleMercenaryAnnouncementChannelSelect],
  ["merc_payout_channel_select", configCommand.handleMercenaryPayoutChannelSelect],
  ["merc_registration_channel_select", configCommand.handleMercenaryRegistrationChannelSelect],
  ["merc_hit_post_channel_select", configCommand.handleMercenaryHitPostChannelSelect],
  ["merc_audit_channel_select", configCommand.handleMercenaryAuditChannelSelect],
  ["bazaar_mug_channel_select", configCommand.handleBazaarMugChannelSelect],
  ["rr_channel_select_post", configCommand.handleReactionRolesChannelSelect],
]);

/**
 * Handle all button interactions
 */
export async function handleButtonInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (!interaction.isButton()) {
    return false;
  }

  const { customId } = interaction;

  const directHandler = buttonHandlers.get(customId);
  if (directHandler) {
    await directHandler(interaction);
    return true;
  }

  const prefixedHandler = buttonPrefixHandlers.find(({ prefix }) =>
    customId.startsWith(prefix),
  );
  if (prefixedHandler) {
    await prefixedHandler.handler(interaction);
    return true;
  }

  if (
    customId.startsWith("tt_selector_") ||
    customId.startsWith("tt_selector_edit_session|") ||
    customId.startsWith("tt_selector_publish_confirm|")
  ) {
    await ttSelectorCommand.handleButtonInteraction(interaction);
    return true;
  }

  return false;
}

const modalPrefixHandlers: Array<{
  prefix: string;
  handler: ModalHandler;
}> = [
  {
    prefix: "rr_modal_create_message|",
    handler: configCommand.handleReactionRolesModalSubmit,
  },
];

/**
 * Handle all modal submit interactions
 */
export async function handleModalSubmitInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (!interaction.isModalSubmit()) {
    return false;
  }

  const { customId } = interaction;
  const modalHandler = modalHandlers.get(customId);
  if (modalHandler) {
    await modalHandler(interaction);
    return true;
  }

  const prefixedHandler = modalPrefixHandlers.find(({ prefix }) =>
    customId.startsWith(prefix),
  );
  if (prefixedHandler) {
    await prefixedHandler.handler(interaction);
    return true;
  }

  return false;
}

/**
 * Handle all string select menu interactions
 */
export async function handleStringSelectMenuInteraction(
  interaction: Interaction,
  _client: Client,
): Promise<boolean> {
  if (!interaction.isStringSelectMenu()) {
    return false;
  }

  const { customId } = interaction;

  const directHandler = stringSelectHandlers.get(customId);
  if (directHandler) {
    await directHandler(interaction);
    return true;
  }

  const prefixedHandler = stringSelectPrefixHandlers.find(({ prefix }) =>
    customId.startsWith(prefix),
  );
  if (prefixedHandler) {
    await prefixedHandler.handler(interaction);
    return true;
  }

  return false;
}

/**
 * Handle all role select menu interactions
 */
export async function handleRoleSelectMenuInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (!interaction.isRoleSelectMenu()) {
    return false;
  }

  const { customId } = interaction;
  const roleHandler = roleSelectHandlers.get(customId);
  if (roleHandler) {
    await roleHandler(interaction);
    return true;
  }

  const prefixedHandler = roleSelectPrefixHandlers.find(({ prefix }) =>
    customId.startsWith(prefix),
  );
  if (prefixedHandler) {
    await prefixedHandler.handler(interaction);
    return true;
  }

  return false;
}

/**
 * Handle all channel select menu interactions
 */
export async function handleChannelSelectMenuInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (!interaction.isChannelSelectMenu()) {
    return false;
  }

  const { customId } = interaction;

  const channelHandler = channelSelectHandlers.get(customId);
  if (channelHandler) {
    await channelHandler(interaction);
    return true;
  }

  if (customId.startsWith("tt_selector_")) {
    await ttSelectorCommand.handleChannelSelectMenuInteraction(interaction);
    return true;
  }

  return false;
}

function isConfigCustomId(customId: string): boolean {
  if (!customId) return false;

  const configPrefixes = [
    "config_",
    "revive_settings_show",
    "revive_set_",
    "revive_refresh_panel",
    "revive_request_channel_select",
    "revive_output_channel_select",
    "revive_ping_role_select",
    "revive_min_hosp_modal",
    "assist_settings_show",
    "assist_set_",
    "assist_manage_",
    "assist_channel_select",
    "assist_ping_role_select",
    "assist_script_roles_select",
    "assist_config_",
    "territories_",
    "mercenary_settings_show",
    "merc_announcement_",
    "merc_clear_",
    "merc_payout_",
    "merc_registration_channel_select",
    "merc_hit_post_",
    "merc_audit_",
    "merc_roles_",
    "merc_toggle_",
    "merc_set_",
    "merc_max_",
    "merc_dibs_time_",
    "merc_create_",
    "bazaar_mug_",
    "rr_"
  ];

  return configPrefixes.some((prefix) => customId.startsWith(prefix));
}

/**
 * Route interaction to appropriate handler
 */
export async function routeInteractionHandler(
  interaction: Interaction,
  client: Client,
): Promise<boolean> {
  // Session validation guard for config dashboard components
  let customId = "";
  if (
    interaction.isButton() ||
    interaction.isStringSelectMenu() ||
    interaction.isRoleSelectMenu() ||
    interaction.isChannelSelectMenu() ||
    interaction.isModalSubmit()
  ) {
    customId = interaction.customId;
  }

  if (isConfigCustomId(customId)) {
    const { validateConfigInteraction } = await import("../commands/general/admin/config.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isValid = await validateConfigInteraction(interaction as any);
    if (!isValid) {
      return true; // Stop execution, interaction has been handled/rejected
    }
  }

  if (customId.startsWith("admin_")) {
    const { validateAdminInteraction } = await import("../commands/general/admin/admin.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isValid = await validateAdminInteraction(interaction as any);
    if (!isValid) {
      return true; // Stop execution, interaction has been handled/rejected
    }
  }

  if (customId.startsWith("admin_")) {
    const { validateAdminInteraction } = await import("../commands/general/admin/admin.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isValid = await validateAdminInteraction(interaction as any);
    if (!isValid) {
      return true; // Stop execution, interaction has been handled/rejected
    }
  }

  if (await handleButtonInteraction(interaction)) {
    return true;
  }
  if (await handleModalSubmitInteraction(interaction)) {
    return true;
  }
  if (await handleStringSelectMenuInteraction(interaction, client)) {
    return true;
  }
  if (await handleRoleSelectMenuInteraction(interaction)) {
    return true;
  }
  if (await handleChannelSelectMenuInteraction(interaction)) {
    return true;
  }

  return false;
}
