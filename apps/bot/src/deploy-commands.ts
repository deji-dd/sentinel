import "dotenv/config";
import { REST, Routes } from "discord.js";
import * as financeCommand from "./commands/finance.js";
import * as financeSettingsCommand from "./commands/finance-settings.js";
import * as forceRunCommand from "./commands/force-run.js";
import * as settingsBuildCommand from "./commands/settings-build.js";
import * as deployCommandsCommand from "./commands/deploy-commands.js";

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

console.log(
  `[Deploy Commands] Using ${isDev ? "local" : "production"} Discord bot`,
);

const commands = [
  financeCommand.data.toJSON(),
  financeSettingsCommand.data,
  forceRunCommand.data.toJSON(),
  settingsBuildCommand.data.toJSON(),
  deployCommandsCommand.data.toJSON(),
];

const rest = new REST({ version: "10" }).setToken(discordToken);

async function deployCommands() {
  try {
    console.log("Registering global slash commands...");

    await rest.put(Routes.applicationCommands(clientId), {
      body: commands,
    });

    console.log("Successfully registered global commands.");
  } catch (error) {
    console.error("Failed to register commands:", error);
    process.exit(1);
  }
}

deployCommands();
