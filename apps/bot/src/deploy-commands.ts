import "dotenv/config";
import { REST, Routes } from "discord.js";

import * as inviteCommand from "./commands/personal/admin/invite.js";
import * as verifyCommand from "./commands/general/verification/verify.js";
import * as verifyallCommand from "./commands/general/verification/verifyall.js";
import * as assaultCheckCommand from "./commands/general/territories/assault-check.js";
import * as burnMapCommand from "./commands/general/territories/burn-map.js";
import * as allianceMapCommand from "./commands/general/territories/alliance-map.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const discordToken = requireEnv("DISCORD_BOT_TOKEN");
const clientId = requireEnv("DISCORD_CLIENT_ID");
const adminGuildId = requireEnv("ADMIN_GUILD_ID");

// Deploy to admin guild only on startup
const commands = [
  inviteCommand.data.toJSON(),
  verifyCommand.data.toJSON(),
  verifyallCommand.data.toJSON(),
  assaultCheckCommand.data.toJSON(),
  burnMapCommand.data.toJSON(),
  allianceMapCommand.data.toJSON(),
];

const rest = new REST({ version: "10" }).setToken(discordToken);

async function deployCommands() {
  try {
    console.log(
      `[Deploy Commands] Clearing global commands and registering to admin guild ${adminGuildId}...`,
    );

    // Deploy global commands (clear them)
    await rest.put(Routes.applicationCommands(clientId), {
      body: [],
    });
    console.log("[Deploy Commands] Registered global commands.");

    // Deploy commands to admin guild only
    await rest.put(Routes.applicationGuildCommands(clientId, adminGuildId), {
      body: commands,
    });

    console.log(
      "[Deploy Commands] Successfully registered commands to admin guild.",
    );
    process.exit(0);
  } catch (error) {
    console.error("[Deploy Commands] Failed to register commands:", error);
    process.exit(1);
  }
}

deployCommands();
