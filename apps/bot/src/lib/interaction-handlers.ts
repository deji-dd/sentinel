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
import * as assistCommand from "../commands/general/assist/assist.js";
import * as ttSelectorCommand from "../commands/general/territories/tt-selector.js";

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
  ["revive_settings_show", configCommand.handleShowReviveSettings],
  ["revive_set_request_channel", configCommand.handleReviveSetRequestChannel],
  ["revive_set_output_channel", configCommand.handleReviveSetOutputChannel],
  ["revive_set_ping_role", configCommand.handleReviveSetPingRole],
  ["revive_set_min_hosp", configCommand.handleReviveSetMinHospButton],
  ["revive_refresh_panel", configCommand.handleReviveRefreshPanel],
  ["revive_request_me", configCommand.handleReviveRequestMe],
  ["revive_request_other", configCommand.handleReviveRequestOther],
  ["assist_settings_show", configCommand.handleShowAssistSettings],
  ["assist_set_channel", configCommand.handleAssistSetChannel],
  ["assist_set_ping_role", configCommand.handleAssistSetPingRole],
  ["assist_set_script_roles", configCommand.handleAssistSetScriptRoles],
  ["assist_manage_users", configCommand.handleAssistManageUsers],
]);

const buttonPrefixHandlers: Array<{ prefix: string; handler: ButtonHandler }> =
  [
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
  ];

const modalHandlers = new Map<string, ModalHandler>([
  ["revive_min_hosp_modal", configCommand.handleReviveSetMinHospModal],
  ["revive_request_other_modal", configCommand.handleReviveRequestOtherModal],
  ["tt_selector_create_modal", ttSelectorCommand.handleModalSubmitInteraction],
]);

const stringSelectHandlers = new Map<string, StringSelectHandler>([
  ["config_view_select", configCommand.handleViewSelect],
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
];

const roleSelectHandlers = new Map<string, RoleSelectHandler>([
  ["revive_ping_role_select", configCommand.handleRevivePingRoleSelect],
  ["assist_ping_role_select", configCommand.handleAssistPingRoleSelect],
  ["assist_script_roles_select", configCommand.handleAssistScriptRolesSelect],
]);

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
  if (!modalHandler) {
    return false;
  }

  await modalHandler(interaction);
  return true;
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

  const roleHandler = roleSelectHandlers.get(interaction.customId);
  if (!roleHandler) {
    return false;
  }

  await roleHandler(interaction);
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

/**
 * Route interaction to appropriate handler
 */
export async function routeInteractionHandler(
  interaction: Interaction,
  client: Client,
): Promise<boolean> {
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
