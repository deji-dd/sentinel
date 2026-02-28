/**
 * Regular Commands Router Module
 * Routes and executes non-admin slash commands
 */

import { ChatInputCommandInteraction } from "discord.js";
import * as financeCommand from "../commands/personal/finance/finance.js";
import * as financeSettingsCommand from "../commands/personal/finance/finance-settings.js";
import * as verifyCommand from "../commands/general/verification/verify.js";
import * as verifyallCommand from "../commands/general/verification/verifyall.js";
import * as configCommand from "../commands/general/admin/config.js";
import * as assaultCheckCommand from "../commands/general/territories/assault-check.js";
import * as burnMapCommand from "../commands/general/territories/burn-map.js";
import * as burnMapSimulatorCommand from "../commands/general/territories/burn-map-simulator.js";

/**
 * List of all regular (non-admin) command names
 */
const REGULAR_COMMAND_NAMES = [
  "finance",
  "finance-settings",
  "verify",
  "verifyall",
  "config",
  "assault-check",
  "burn-map",
  "burn-map-simulator",
];

/**
 * Check if a command name is a regular command
 */
export function isRegularCommand(commandName: string): boolean {
  return REGULAR_COMMAND_NAMES.includes(commandName);
}

/**
 * Handle and execute regular commands
 */
export async function handleRegularCommand(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const commandName = interaction.commandName;

  if (!isRegularCommand(commandName)) {
    return false;
  }

  switch (commandName) {
    case "finance":
      await financeCommand.execute(interaction);
      break;
    case "finance-settings":
      await financeSettingsCommand.execute(interaction);
      break;
    case "verify":
      await verifyCommand.execute(interaction);
      break;
    case "verifyall":
      await verifyallCommand.execute(interaction);
      break;
    case "config":
      await configCommand.execute(interaction);
      break;
    case "assault-check":
      await assaultCheckCommand.execute(interaction);
      break;
    case "burn-map":
      await burnMapCommand.execute(interaction);
      break;
    case "burn-map-simulator":
      await burnMapSimulatorCommand.execute(interaction);
      break;
  }

  return true;
}
