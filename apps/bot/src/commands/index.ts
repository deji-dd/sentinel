import { Collection, type ChatInputCommandInteraction } from "discord.js";
import type { ModuleKey } from "@sentinel/utils";
import { pingCommand } from "./ping.js";
import { inviteCommand } from "./invite.js";
import { configCommand } from "./config.js";
import { verifyCommand } from "./verify.js";
import { verifyallCommand } from "./verifyall.js";
import * as assaultCheckCommand from "./assault-check.js";
import * as allianceMapCommand from "./alliance-map.js";
import * as burnMapCommand from "./burn-map.js";
import * as ttSelectorCommand from "./tt-selector.js";

export type BotCommand = {
  data: any;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  module?: ModuleKey;
};

export const commandsList: BotCommand[] = [
  { ...pingCommand, module: undefined },
  { ...inviteCommand, module: undefined },
  { ...configCommand, module: undefined },
  { ...ttSelectorCommand, module: undefined },
  { ...verifyCommand, module: "verification" },
  { ...verifyallCommand, module: "verification" },
  { ...assaultCheckCommand, module: "territory" },
  { ...allianceMapCommand, module: "territory" },
  { ...burnMapCommand, module: "territory" },
];

export function buildCommandsCollection(): Collection<string, BotCommand> {
  const collection = new Collection<string, BotCommand>();
  for (const cmd of commandsList) {
    collection.set(cmd.data.name, cmd);
  }
  return collection;
}
