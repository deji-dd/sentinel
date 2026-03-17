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
import * as statsCommand from "../commands/personal/stats.js";
import * as assistCommand from "../commands/general/assist/assist.js";
import * as ttSelectorCommand from "../commands/general/territories/tt-selector.js";

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
  } else if (customId === "config_open_dashboard") {
    await configCommand.handleOpenDashboard(interaction);
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
  } else if (customId === "reaction_roles_settings_show") {
    await configCommand.handleShowReactionRolesSettings(interaction);
  } else if (customId === "reaction_roles_edit_allowed") {
    await configCommand.handleEditReactionRolesAllowed(interaction);
  } else if (customId === "reaction_roles_create_message") {
    await configCommand.handleCreateReactionRoleMessage(interaction);
  } else if (customId === "reaction_roles_view_messages") {
    await configCommand.handleViewReactionRoleMessages(interaction);
  } else if (customId === "reaction_roles_edit_mappings") {
    await configCommand.handleEditReactionRoleMappings(interaction);
  } else if (customId === "reaction_roles_delete_message") {
    await configCommand.handleDeleteReactionRoleMessage(interaction);
  } else if (customId.startsWith("reaction_roles_edit_select_return|")) {
    await configCommand.handleEditReactionRoleMappingsReturn(interaction);
  } else if (customId === "reaction_roles_cancel_create") {
    await configCommand.handleCancelReactionRoleCreate(interaction);
  } else if (customId.startsWith("reaction_role_add_mapping|")) {
    await configCommand.handleAddReactionRoleMapping(interaction);
  } else if (customId.startsWith("reaction_role_edit_add_mapping|")) {
    await configCommand.handleEditReactionRoleAddMapping(interaction);
  } else if (customId.startsWith("reaction_role_edit_remove_mapping|")) {
    await configCommand.handleEditReactionRoleRemoveMapping(interaction);
  } else if (customId.startsWith("reaction_role_post_message|")) {
    await configCommand.handlePostReactionRoleMessage(interaction);
  } else if (customId === "reaction_roles_create_mapping") {
    await configCommand.handleCreateReactionRoleMapping(interaction);
  } else if (customId === "reaction_roles_view_mappings") {
    await configCommand.handleViewReactionRoleMappings(interaction);
  } else if (customId === "reaction_roles_select_delete") {
    await configCommand.handleSelectDeleteReactionRoleMapping(interaction);
  } else if (customId === "revive_settings_show") {
    await configCommand.handleShowReviveSettings(interaction);
  } else if (customId === "revive_set_request_channel") {
    await configCommand.handleReviveSetRequestChannel(interaction);
  } else if (customId === "revive_set_output_channel") {
    await configCommand.handleReviveSetOutputChannel(interaction);
  } else if (customId === "revive_set_ping_role") {
    await configCommand.handleReviveSetPingRole(interaction);
  } else if (customId === "revive_set_min_hosp") {
    await configCommand.handleReviveSetMinHospButton(interaction);
  } else if (customId === "revive_refresh_panel") {
    await configCommand.handleReviveRefreshPanel(interaction);
  } else if (customId === "revive_request_me") {
    await configCommand.handleReviveRequestMe(interaction);
  } else if (customId === "revive_request_other") {
    await configCommand.handleReviveRequestOther(interaction);
  } else if (customId.startsWith("revive_confirm_request")) {
    await configCommand.handleReviveConfirmRequest(interaction);
  } else if (customId.startsWith("revive_cancel_request|")) {
    await configCommand.handleReviveCancelRequest(interaction);
  } else if (customId.startsWith("revive_mark_revived|")) {
    await configCommand.handleReviveMarkRevived(interaction);
  } else if (customId === "assist_settings_show") {
    await configCommand.handleShowAssistSettings(interaction);
  } else if (customId === "assist_set_channel") {
    await configCommand.handleAssistSetChannel(interaction);
  } else if (customId === "assist_set_ping_role") {
    await configCommand.handleAssistSetPingRole(interaction);
  } else if (customId === "assist_set_script_roles") {
    await configCommand.handleAssistSetScriptRoles(interaction);
  } else if (customId === "assist_manage_users") {
    await configCommand.handleAssistManageUsers(interaction);
  } else if (
    customId.startsWith("assist_config_page_prev|") ||
    customId.startsWith("assist_config_page_next|")
  ) {
    await configCommand.handleAssistManagePageButton(interaction);
  } else if (customId.startsWith("assist_config_manage_back|")) {
    await configCommand.handleAssistManageBackButton(interaction);
  } else if (
    customId.startsWith("assist_manage_page_prev|") ||
    customId.startsWith("assist_manage_page_next|")
  ) {
    await assistCommand.handleManagePageButton(interaction);
  } else if (customId.startsWith("assist_manage_back|")) {
    await assistCommand.handleManageBackButton(interaction);
  }
  
  // TT Selector buttons
  if (
    customId.startsWith("tt_selector_") ||
    customId.startsWith("tt_selector_edit_session|") ||
    customId.startsWith("tt_selector_publish_confirm|")
  ) {
    await ttSelectorCommand.handleButtonInteraction(interaction);
    return true;
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
    if (customId === "config_nickname_template_modal") {
    await configCommand.handleNicknameTemplateModalSubmit(interaction);
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
  } else if (customId.startsWith("reaction_roles_create_embed_modal|")) {
    await configCommand.handleCreateReactionRoleEmbedModal(interaction);
  } else if (customId.startsWith("reaction_role_mapping_emoji_modal|")) {
    await configCommand.handleMappingEmojiModal(interaction);
  } else if (customId === "reaction_roles_create_modal") {
    await configCommand.handleCreateReactionRoleMappingModal(interaction);
  } else if (customId === "revive_min_hosp_modal") {
    await configCommand.handleReviveSetMinHospModal(interaction);
  } else if (customId === "revive_request_other_modal") {
    await configCommand.handleReviveRequestOtherModal(interaction);
  }
  
  // TT Selector modals
  if (customId === "tt_selector_create_modal") {
    await ttSelectorCommand.handleModalSubmitInteraction(interaction);
    return true;
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
  if (customId === "config_view_select") {
    await configCommand.handleViewSelect(interaction);
  } else if (customId === "verify_settings_edit") {
    await configCommand.handleVerifySettingsEdit(interaction);
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
  } else if (customId === "reaction_roles_delete_select") {
    await configCommand.handleDeleteReactionRoleMapping(interaction);
  } else if (customId === "reaction_roles_edit_select") {
    await configCommand.handleEditReactionRoleMappingSelect(interaction);
  } else if (customId.startsWith("reaction_role_edit_remove_select|")) {
    await configCommand.handleEditReactionRoleRemoveMappingSelect(interaction);
  } else if (customId.startsWith("assist_config_user_select|")) {
    await configCommand.handleAssistManageUserSelect(interaction);
  } else if (customId.startsWith("assist_config_action_select|")) {
    await configCommand.handleAssistManageActionSelect(interaction);
  } else if (customId.startsWith("assist_manage_user_select|")) {
    await assistCommand.handleManageUserSelect(interaction);
  } else if (customId.startsWith("assist_manage_action_select|")) {
    await assistCommand.handleManageActionSelect(interaction);
  }
  // TT Selector selects
  else if (customId.startsWith("tt_selector_")) {
    await ttSelectorCommand.handleStringSelectMenuInteraction(interaction);
    return true;
  }
  // Stats command
  else if (customId === "stats_timeframe_select") {
    await statsCommand.handleTimeframeSelect(interaction);
  }
  // Unknown
  else {
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
  } else if (customId === "reaction_roles_allowed_select") {
    await configCommand.handleAllowedRolesSelect(interaction);
  } else if (customId.startsWith("reaction_role_mapping_role_select|")) {
    await configCommand.handleMappingRoleSelect(interaction);
  } else if (customId === "revive_ping_role_select") {
    await configCommand.handleRevivePingRoleSelect(interaction);
  } else if (customId === "assist_ping_role_select") {
    await configCommand.handleAssistPingRoleSelect(interaction);
  } else if (customId === "assist_script_roles_select") {
    await configCommand.handleAssistScriptRolesSelect(interaction);
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

  if (customId === "config_faction_list_channel_select") {
    await configCommand.handleFactionListChannelSelect(interaction);
  } else if (customId === "tt_full_channel_select") {
    await configCommand.handleTTFullChannelSelect(interaction);
  } else if (customId === "tt_filtered_channel_select") {
    await configCommand.handleTTFilteredChannelSelect(interaction);
  } else if (customId.startsWith("tt_war_track_channel_select")) {
    await configCommand.handleTTWarTrackChannelSelect(interaction);
  } else if (customId === "reaction_roles_channel_select") {
    await configCommand.handleChannelSelectForReactionRoles(interaction);
  } else if (customId === "revive_request_channel_select") {
    await configCommand.handleReviveRequestChannelSelect(interaction);
  } else if (customId === "revive_output_channel_select") {
    await configCommand.handleReviveOutputChannelSelect(interaction);
  } else if (customId === "assist_channel_select") {
    await configCommand.handleAssistChannelSelect(interaction);
  } else if (customId.startsWith("tt_selector_")) {
    await ttSelectorCommand.handleChannelSelectMenuInteraction(interaction);
    return true;
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
