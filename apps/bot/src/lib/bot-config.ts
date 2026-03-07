/**
 * Bot Configuration Module
 * Handles environment setup, validation, and client initialization
 */

import { Client, GatewayIntentBits, Partials } from "discord.js";

export const isDev = process.env.NODE_ENV === "development";

/**
 * Validate database configuration
 */
export function initializeDatabaseConfig(): {
  dbPath: string;
} {
  const dbPath = isDev
    ? process.env.SQLITE_DB_PATH_LOCAL || "./data/sentinel-local.db"
    : process.env.SQLITE_DB_PATH || "./data/sentinel.db";

  console.log(`[Bot] Using SQLite database path: ${dbPath}`);

  return { dbPath };
}

/**
 * Load and validate Discord bot token
 */
export function initializeDiscordToken(): string {
  const discordToken = isDev
    ? process.env.DISCORD_BOT_TOKEN_LOCAL!
    : process.env.DISCORD_BOT_TOKEN!;

  if (!discordToken) {
    throw new Error(
      `Missing Discord bot token for ${isDev ? "local" : "cloud"} environment`,
    );
  }

  console.log(
    `[Bot] Using ${isDev ? "local" : "production"} Discord bot instance`,
  );

  return discordToken;
}

/**
 * Load and validate authorized Discord user ID
 */
export function initializeAuthorizedUserId(): string {
  const authorizedDiscordUserId = process.env.SENTINEL_DISCORD_USER_ID;

  if (!authorizedDiscordUserId) {
    throw new Error(
      "SENTINEL_DISCORD_USER_ID environment variable is required",
    );
  }

  return authorizedDiscordUserId;
}

/**
 * Create Discord client with standard intents
 */
export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });
}

/**
 * Get HTTP port for the bot server
 */
export function getHttpPort(): number {
  return isDev ? 3001 : parseInt(process.env.HTTP_PORT || "3001");
}
