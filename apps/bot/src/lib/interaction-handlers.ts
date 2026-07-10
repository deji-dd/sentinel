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
  ["admin_guild_init_modal_btn", adminCommand.handleGuildInitModalBtn],
  ["admin_back_to_main", (i) => adminCommand.handleShowMainDashboard(i)],
  [
    "admin_guild_modules_back_to_list",
    (i) => adminCommand.handleShowGuildModules(i),
  ],
  ["admin_redeploy_confirm", adminCommand.handleRedeployConfirm],
  [
    "admin_guild_deinit_back_to_list",
    (i) => adminCommand.handleShowGuildDeinit(i),
  ],
  [
    "config_verify_back_to_settings",
    (i) => verifyHandlers.handleShowVerifySettings(i),
  ],
  ["config_verify_back_to_mappings", verifyHandlers.handleShowFactionMappings],
  [
    "config_verify_toggle_auto_verify_btn",
    verifyHandlers.handleVerifyToggleAutoVerifyBtn,
  ],
  [
    "config_verify_edit_nickname_btn",
    verifyHandlers.handleVerifyEditNicknameBtn,
  ],
  ["config_verify_add_faction_btn", verifyHandlers.handleVerifyAddFactionBtn],
  ["territories_settings_show", configCommand.handleShowTerritoriesSettings],
  [
    "territories_set_watched_territories_btn",
    configCommand.handleTerritoriesSetWatchedTerritoriesBtn,
  ],
  [
    "territories_set_watched_factions_btn",
    configCommand.handleTerritoriesSetWatchedFactionsBtn,
  ],
  ["bazaar_mug_settings_show", configCommand.handleShowBazaarMugSettings],
  [
    "bazaar_mug_set_threshold_btn",
    configCommand.handleBazaarMugSetThresholdBtn,
  ],
  [
    "bazaar_mug_set_min_offline_btn",
    configCommand.handleBazaarMugSetMinOfflineBtn,
  ],
  [
    "bazaar_mug_edit_watchlist_btn",
    configCommand.handleBazaarMugEditWatchlistBtn,
  ],
  [
    "bazaar_mug_clear_channel_btn",
    configCommand.handleBazaarMugClearChannelBtn,
  ],
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
      prefix: "bazaar_mug_page_prev|",
      handler: async (_interaction) => {},
    },
    {
      prefix: "bazaar_mug_page_next|",
      handler: async (_interaction) => {},
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
    },
  ];

const modalHandlers = new Map<string, ModalHandler>([
  ["config_add_api_key_modal", configCommand.handleConfigAddApiKeyModal],
  ["admin_guild_init_modal", adminCommand.handleGuildInitModalSubmit],
  [
    "config_verify_nickname_modal",
    verifyHandlers.handleVerifyNicknameModalSubmit,
  ],
  [
    "config_verify_add_faction_modal",
    verifyHandlers.handleVerifyAddFactionModalSubmit,
  ],
  [
    "territories_watched_territories_modal",
    configCommand.handleTerritoriesWatchedTerritoriesModal,
  ],
  [
    "territories_watched_factions_modal",
    configCommand.handleTerritoriesWatchedFactionsModal,
  ],
  ["bazaar_mug_threshold_modal", configCommand.handleBazaarMugThresholdModal],
  [
    "bazaar_mug_min_offline_modal",
    configCommand.handleBazaarMugMinOfflineModal,
  ],
  ["bazaar_mug_watchlist_modal", configCommand.handleBazaarMugWatchlistModal],
]);

const stringSelectHandlers = new Map<string, StringSelectHandler>([
  ["config_view_select", configCommand.handleViewSelect],
  [
    "config_remove_api_key_select",
    configCommand.handleConfigRemoveApiKeySelect,
  ],
  ["config_admin_setting_select", configCommand.handleAdminSettingSelect],
  ["admin_dashboard_select", adminCommand.handleAdminDashboardSelect],
  ["admin_guild_init_select", adminCommand.handleGuildInitSelect],
  ["admin_guild_deinit_select", adminCommand.handleGuildDeinitSelect],
  [
    "admin_guild_modules_guild_select",
    adminCommand.handleGuildModulesGuildSelect,
  ],
  ["config_verify_setting_select", verifyHandlers.handleVerifySettingSelect],
  ["config_verify_faction_select", verifyHandlers.handleVerifyFactionSelect],
  [
    "config_territories_setting_select",
    configCommand.handleTerritoriesSettingSelect,
  ],
  [
    "config_bazaar_mug_setting_select",
    configCommand.handleBazaarMugSettingSelect,
  ],
  [
    "config_reaction_roles_setting_select",
    configCommand.handleReactionRolesSettingSelect,
  ],
  ["rr_select_manage_msg", configCommand.handleReactionRolesSelectMessage],
]);

const stringSelectPrefixHandlers: Array<{
  prefix: string;
  handler: StringSelectHandler;
}> = [
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
  ["config_admin_roles_select", configCommand.handleAdminRolesSelect],
  ["config_verify_roles_select", verifyHandlers.handleVerifyRolesSelect],
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
  },
];

const channelSelectHandlers = new Map<string, ChannelSelectHandler>([
  ["config_log_channel_select", configCommand.handleLogChannelSelect],
  ["config_verify_channel_select", verifyHandlers.handleVerifyChannelSelect],
  [
    "territories_full_channel_select",
    configCommand.handleTerritoriesFullChannelSelect,
  ],
  [
    "territories_filtered_channel_select",
    configCommand.handleTerritoriesFilteredChannelSelect,
  ],
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
  return false;
}

function isConfigCustomId(customId: string): boolean {
  if (!customId) return false;

  const configPrefixes = [
    "config_",
    "territories_",
    "bazaar_mug_",
    "rr_",
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
    const { validateConfigInteraction } =
      await import("../commands/general/admin/config.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isValid = await validateConfigInteraction(interaction as any);
    if (!isValid) {
      return true; // Stop execution, interaction has been handled/rejected
    }
  }

  if (customId.startsWith("admin_")) {
    const { validateAdminInteraction } =
      await import("../commands/general/admin/admin.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isValid = await validateAdminInteraction(interaction as any);
    if (!isValid) {
      return true; // Stop execution, interaction has been handled/rejected
    }
  }

  if (customId.startsWith("admin_")) {
    const { validateAdminInteraction } =
      await import("../commands/general/admin/admin.js");
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
