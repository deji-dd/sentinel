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

const buttonHandlers = new Map<string, ButtonHandler>([]);
const buttonPrefixHandlers: Array<{ prefix: string; handler: ButtonHandler }> = [];

const modalHandlers = new Map<string, ModalHandler>([]);
const modalPrefixHandlers: Array<{ prefix: string; handler: ModalHandler }> = [];

const stringSelectHandlers = new Map<string, StringSelectHandler>([]);
const stringSelectPrefixHandlers: Array<{
  prefix: string;
  handler: StringSelectHandler;
}> = [];

const roleSelectHandlers = new Map<string, RoleSelectHandler>([]);
const roleSelectPrefixHandlers: Array<{
  prefix: string;
  handler: RoleSelectHandler;
}> = [];

const channelSelectHandlers = new Map<string, ChannelSelectHandler>([]);

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
