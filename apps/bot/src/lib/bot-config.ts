/**
 * Bot Configuration Module
 * Handles environment setup, validation, and client initialization
 */

import { Client, GatewayIntentBits, Partials } from "discord.js";
import { Logger } from "@sentinel/shared";

const logger = new Logger("Bot");

// Determine environment
const nodeEnv = (process.env.NODE_ENV || "").trim().toLowerCase();
// Robust dev detection: check NODE_ENV or existence of local-only variables
export const isDev = nodeEnv === "development" || nodeEnv === "dev";

/**
 * Validate database configuration
 */
export function initializeDatabaseConfig(): {
  dbPath: string;
} {
  const dbPath = process.env.SQLITE_DB_PATH || "./data/sentinel.db";
  logger.debug(`Using SQLite database path: ${dbPath}`);
  return { dbPath };
}

/**
 * Load and validate Discord bot token
 */
export function initializeDiscordToken(): string {
  const discordToken = process.env.DISCORD_BOT_TOKEN;

  if (!discordToken) {
    throw new Error("DISCORD_BOT_TOKEN environment variable is required");
  }

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
  return parseInt(process.env.HTTP_PORT || "3001", 10);
}
