/**
 * Interaction Handlers Router Module
 * Routes and handles buttons, modals, and select menus
 */

import { Client, type Interaction } from "discord.js";
import * as setupGuildCommand from "../commands/personal/admin/setup-guild.js";
import * as teardownGuildCommand from "../commands/personal/admin/teardown-guild.js";
import * as enableModuleCommand from "../commands/personal/admin/enable-module.js";
import * as removeModuleCommand from "../commands/personal/admin/remove-module.js";
import * as configCommand from "../commands/general/admin/config.js";

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

  // Config command buttons
  if (customId === "config_back_to_menu") {
    await configCommand.handleBackToMenu(interaction);
  } else if (customId === "config_back_verify_settings") {
    await configCommand.handleBackToVerifySettings(interaction);
  } else if (customId === "config_back_admin_settings") {
    await configCommand.handleBackToAdminSettings(interaction);
  } else if (customId === "config_edit_api_keys") {
    await configCommand.handleEditApiKeysButton(interaction);
  } else if (customId === "config_edit_log_channel") {
    await configCommand.handleEditLogChannelButton(interaction);
  } else if (customId === "config_clear_log_channel") {
    await configCommand.handleClearLogChannel(interaction);
  } else if (customId === "config_edit_admin_roles") {
    await configCommand.handleEditAdminRolesButton(interaction);
  } else if (customId === "config_add_api_key") {
    await configCommand.handleAddApiKeyButton(interaction);
  } else if (customId === "config_rotate_api_key") {
    await configCommand.handleRotateApiKeyButton(interaction);
  } else if (customId === "config_remove_api_key_menu") {
    await configCommand.handleRemoveApiKeyMenuButton(interaction);
  } else if (customId === "config_add_faction_role") {
    await configCommand.handleAddFactionRoleButton(interaction);
  } else if (customId === "config_remove_faction_role") {
    await configCommand.handleRemoveFactionRoleButton(interaction);
  } else if (customId === "config_faction_manage_back") {
    await configCommand.handleFactionManageBack(interaction);
  } else if (customId.startsWith("config_faction_toggle_")) {
    await configCommand.handleFactionToggle(interaction);
  } else if (customId.startsWith("config_faction_member_roles_")) {
    await configCommand.handleFactionMemberRolesButton(interaction);
  } else if (customId.startsWith("config_faction_leader_roles_")) {
    await configCommand.handleFactionLeaderRolesButton(interaction);
  } else if (customId === "confirm_auto_verify_toggle") {
    await configCommand.handleConfirmAutoVerifyToggle(interaction);
  } else if (customId === "verify_settings_edit_cancel") {
    await configCommand.handleVerifySettingsEditCancel(interaction);
  } else if (customId === "tt_settings_show") {
    await configCommand.handleShowTTSettings(interaction);
  } else if (customId === "tt_full_channel_clear") {
    await configCommand.handleTTFullChannelClear(interaction);
  } else if (customId === "tt_filtered_channel_clear") {
    await configCommand.handleTTFilteredChannelClear(interaction);
  } else if (
    customId.startsWith("tt_war_track_page_prev") ||
    customId.startsWith("tt_war_track_page_next")
  ) {
    await configCommand.handleTTWarTrackPage(interaction);
  } else if (customId.startsWith("tt_war_track_back")) {
    await configCommand.handleTTWarTrackBack(interaction);
  } else if (customId.startsWith("tt_war_track_channel_clear")) {
    await configCommand.handleTTWarTrackChannelClear(interaction);
  } else if (customId.startsWith("tt_war_track_away_filter")) {
    await configCommand.handleTTWarTrackAwayFilterButton(interaction);
  } else if (
    customId.startsWith("config_faction_role_menu_prev_") ||
    customId.startsWith("config_faction_role_menu_next_")
  ) {
    await configCommand.handleFactionRoleMenuPage(interaction);
  } else {
    return false;
  }

  return true;
}

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

  // Config command modals
  if (customId.startsWith("config_add_api_key_modal")) {
    await configCommand.handleAddApiKeyModalSubmit(interaction);
  } else if (customId === "config_nickname_template_modal") {
    await configCommand.handleNicknameTemplateModalSubmit(interaction);
  } else if (customId === "config_sync_interval_modal") {
    await configCommand.handleSyncIntervalModalSubmit(interaction);
  } else if (customId === "config_add_faction_role_modal") {
    await configCommand.handleAddFactionRoleModalSubmit(interaction);
  } else if (customId === "config_remove_faction_role_modal") {
    await configCommand.handleRemoveFactionRoleModalSubmit(interaction);
  } else if (customId === "tt_edit_territories_modal") {
    await configCommand.handleTTEditTerritoriesModalSubmit(interaction);
  } else if (customId === "tt_edit_factions_modal") {
    await configCommand.handleTTEditFactionsModalSubmit(interaction);
  } else if (customId.startsWith("tt_war_track_away_modal")) {
    await configCommand.handleTTWarTrackAwayFilterSubmit(interaction);
  } else {
    return false;
  }

  return true;
}

/**
 * Handle all string select menu interactions
 */
export async function handleStringSelectMenuInteraction(
  interaction: Interaction,
  client: Client,
): Promise<boolean> {
  if (!interaction.isStringSelectMenu()) {
    return false;
  }

  const { customId } = interaction;

  // Setup guild
  if (customId === "setup_guild_select") {
    await setupGuildCommand.handleGuildSelect(interaction);
  } else if (customId.startsWith("setup_modules_select")) {
    await setupGuildCommand.handleModulesSelect(interaction);
  }
  // Teardown guild
  else if (customId === "teardown_guild_select") {
    await teardownGuildCommand.handleTeardownGuildSelect(interaction, client);
  }
  // Enable module
  else if (customId === "enable_module_guild_select") {
    await enableModuleCommand.handleGuildSelect(interaction);
  } else if (customId.startsWith("enable_module_toggle")) {
    await enableModuleCommand.handleModuleToggle(interaction, client);
  }
  // Remove module
  else if (customId === "remove_module_guild_select") {
    await removeModuleCommand.handleGuildSelect(interaction);
  } else if (customId.startsWith("remove_module_select")) {
    await removeModuleCommand.handleModuleRemove(interaction, client);
  }
  // Config command selects
  else if (customId === "config_view_select") {
    await configCommand.handleViewSelect(interaction);
  } else if (customId === "verify_settings_edit") {
    await configCommand.handleVerifySettingsEdit(interaction);
  } else if (customId === "config_remove_api_key_select") {
    await configCommand.handleRemoveApiKeySelect(interaction);
  } else if (customId === "config_faction_manage_select") {
    await configCommand.handleFactionManageSelect(interaction);
  } else if (customId === "tt_settings_edit") {
    await configCommand.handleTTSettingsEdit(interaction);
  } else if (customId === "tt_filtered_settings_edit") {
    await configCommand.handleTTFilteredSettingsEdit(interaction);
  } else if (customId === "tt_notification_type_select") {
    await configCommand.handleTTNotificationTypeSelect(interaction);
  } else if (customId.startsWith("tt_war_track_select")) {
    await configCommand.handleTTWarTrackSelect(interaction);
  } else if (customId.startsWith("tt_war_track_enemy_side")) {
    await configCommand.handleTTWarTrackEnemySideSelect(interaction);
  } else {
    return false;
  }

  return true;
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

  if (customId.startsWith("config_faction_role_select_")) {
    await configCommand.handleFactionRoleSelect(interaction);
  } else if (customId.startsWith("config_faction_member_roles_select_")) {
    await configCommand.handleFactionMemberRolesSelect(interaction);
  } else if (customId.startsWith("config_faction_leader_roles_select_")) {
    await configCommand.handleFactionLeaderRolesSelect(interaction);
  } else if (customId === "config_verified_role_select") {
    await configCommand.handleVerifiedRoleSelect(interaction);
  } else if (customId === "config_admin_roles_select") {
    await configCommand.handleAdminRolesSelect(interaction);
  } else {
    return false;
  }

  return true;
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

  if (customId === "config_log_channel_select") {
    await configCommand.handleLogChannelSelect(interaction);
  } else if (customId === "tt_full_channel_select") {
    await configCommand.handleTTFullChannelSelect(interaction);
  } else if (customId === "tt_filtered_channel_select") {
    await configCommand.handleTTFilteredChannelSelect(interaction);
  } else if (customId.startsWith("tt_war_track_channel_select")) {
    await configCommand.handleTTWarTrackChannelSelect(interaction);
  } else {
    return false;
  }

  return true;
}

/**
 * Route interaction to appropriate handler
 */
export async function routeInteractionHandler(
  interaction: Interaction,
  client: Client,
): Promise<boolean> {
  // Try handlers in order
  if (!(await handleButtonInteraction(interaction))) {
    if (!(await handleModalSubmitInteraction(interaction))) {
      if (!(await handleStringSelectMenuInteraction(interaction, client))) {
        if (!(await handleRoleSelectMenuInteraction(interaction))) {
          if (!(await handleChannelSelectMenuInteraction(interaction))) {
            return false;
          }
        }
      }
    }
  }
  return true;
}
