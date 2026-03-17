/**
 * Bot Configuration Module
 * Handles environment setup, validation, and client initialization
 */

import { Client, GatewayIntentBits, Partials } from "discord.js";

// Determine environment
const nodeEnv = (process.env.NODE_ENV || "").trim().toLowerCase();
// Robust dev detection: check NODE_ENV or existence of local-only variables
export const isDev = 
  nodeEnv === "development" || 
  nodeEnv === "dev" || 
  !!process.env.BOT_ORIGIN_LOCAL || 
  !!process.env.DISCORD_BOT_TOKEN_LOCAL;

/**
 * Validate database configuration
 */
export function initializeDatabaseConfig(): {
  dbPath: string;
} {
  const dbPath = isDev
    ? process.env.SQLITE_DB_PATH_LOCAL || "./data/sentinel-local.db"
    : process.env.SQLITE_DB_PATH || "./data/sentinel.db";

  console.log(`[Bot] Using SQLite database path: ${dbPath} (isDev: ${isDev})`);

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

/**
 * Get the UI base URL (Dashboard/Map Painter)
 */
export function getUiUrl(): string {
  return isDev
    ? process.env.MAP_PAINTER_URL_LOCAL || "http://localhost:3000"
    : process.env.MAP_PAINTER_URL || "https://blasted-labs.tech";
}

/**
 * Get the Map Painter base URL (Aliased to getUiUrl for backward compatibility)
 */
export function getPainterUrl(): string {
  return getUiUrl();
}

/**
 * Get the API base URL for magic link activation
 */
export function getApiUrl(): string {
  return isDev
    ? process.env.BOT_ORIGIN_LOCAL || "http://localhost:3001"
    : process.env.BOT_ORIGIN || "https://api.blasted-labs.tech";
}

/**
 * Get the allowed origins for CORS
 */
export function getAllowedOrigins(): string[] {
  const prodOrigin = process.env.UI_ORIGIN || "https://blasted-labs.tech";
  if (isDev) {
    return ["http://localhost:3000", prodOrigin];
  }
  return [prodOrigin];
}
