import "dotenv/config";
import { REST, Routes } from "discord.js";

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
  {
    name: "setup",
    description: "Link your Torn City account to Sentinel",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "travel",
    description: "Get travel recommendations from Torn City",
    integration_types: [0, 1], // 0 = Guild, 1 = User (bot DMs and private channels)
    contexts: [0, 1, 2], // 0 = Guild, 1 = Bot DM, 2 = Private Channel
  },
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
