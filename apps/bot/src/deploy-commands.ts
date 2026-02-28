import "dotenv/config";
import { REST, Routes } from "discord.js";

import * as deployCommandsCommand from "./commands/personal/admin/deploy-commands.js";
import * as setupGuildCommand from "./commands/personal/admin/setup-guild.js";
import * as teardownGuildCommand from "./commands/personal/admin/teardown-guild.js";
import * as forceRunCommand from "./commands/personal/admin/force-run.js";
import * as addBotCommand from "./commands/personal/admin/add-bot.js";
import * as enableModuleCommand from "./commands/personal/admin/enable-module.js";
import * as guildStatusCommand from "./commands/personal/admin/guild-status.js";
import * as configCommand from "./commands/general/admin/config.js";
import * as verifyCommand from "./commands/general/verification/verify.js";
import * as verifyallCommand from "./commands/general/verification/verifyall.js";
import * as assaultCheckCommand from "./commands/general/territories/assault-check.js";
import * as burnMapCommand from "./commands/general/territories/burn-map.js";
import * as burnMapSimulatorCommand from "./commands/general/territories/burn-map-simulator.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// Use local Discord bot in development, production bot in production
const isDev = process.env.NODE_ENV === "development";
const discordToken = isDev
  ? requireEnv("DISCORD_BOT_TOKEN_LOCAL")
  : requireEnv("DISCORD_BOT_TOKEN");
const clientId = isDev
  ? requireEnv("DISCORD_CLIENT_ID_LOCAL")
  : requireEnv("DISCORD_CLIENT_ID");
const adminGuildId = requireEnv("ADMIN_GUILD_ID");

console.log(
  `[Deploy Commands] Using ${isDev ? "local" : "production"} Discord bot`,
);

// Deploy to admin guild only on startup
const commands = [
  forceRunCommand.data.toJSON(),
  deployCommandsCommand.data.toJSON(),
  setupGuildCommand.data.toJSON(),
  teardownGuildCommand.data.toJSON(),
  addBotCommand.data.toJSON(),
  enableModuleCommand.data.toJSON(),
  guildStatusCommand.data.toJSON(),
  configCommand.data.toJSON(),
  verifyCommand.data.toJSON(),
  verifyallCommand.data.toJSON(),
  assaultCheckCommand.data.toJSON(),
  burnMapCommand.data.toJSON(),
  burnMapSimulatorCommand.data.toJSON(),
];

const rest = new REST({ version: "10" }).setToken(discordToken);

async function deployCommands() {
  try {
    console.log(
      `[Deploy Commands] Clearing global commands and registering to admin guild ${adminGuildId}...`,
    );

    // Clear any global commands that might exist from previous deployments
    await rest.put(Routes.applicationCommands(clientId), {
      body: [],
    });
    console.log("[Deploy Commands] Cleared global commands.");

    // Deploy commands to admin guild only
    await rest.put(Routes.applicationGuildCommands(clientId, adminGuildId), {
      body: commands,
    });

    console.log(
      "[Deploy Commands] Successfully registered commands to admin guild.",
    );
  } catch (error) {
    console.error("[Deploy Commands] Failed to register commands:", error);
    process.exit(1);
  }
}

deployCommands();
