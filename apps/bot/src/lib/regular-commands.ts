/**
 * Regular Commands Router Module
 * Routes and executes non-admin slash commands
 */

import { ChatInputCommandInteraction } from "discord.js";
import * as financeCommand from "../commands/personal/finance/finance.js";
import * as financeSettingsCommand from "../commands/personal/finance/finance-settings.js";
import * as statsCommand from "../commands/personal/stats.js";
import * as verifyCommand from "../commands/general/verification/verify.js";
import * as verifyallCommand from "../commands/general/verification/verifyall.js";
import * as configCommand from "../commands/general/admin/config.js";
import * as assaultCheckCommand from "../commands/general/territories/assault-check.js";
import * as burnMapCommand from "../commands/general/territories/burn-map.js";
import * as allianceMapCommand from "../commands/general/territories/alliance-map.js";
import * as assistCommand from "../commands/general/assist/assist.js";
import * as ttSelectorCommand from "../commands/general/territories/tt-selector.js";

/**
 * List of all regular (non-admin) command names
 */
const REGULAR_COMMAND_NAMES = [
  "finance",
  "finance-settings",
  "stats",
  "verify",
  "verifyall",
  "config",
  "assault-check",
  "burn-map",
  "alliance-map",
  "assist",
  "tt-selector",
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
    case "stats":
      await statsCommand.execute(interaction);
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
    case "alliance-map":
      await allianceMapCommand.execute(interaction);
      break;
    case "assist":
      await assistCommand.execute(interaction);
      break;
    case "tt-selector":
      await ttSelectorCommand.execute(interaction);
      break;
  }

  return true;
}
