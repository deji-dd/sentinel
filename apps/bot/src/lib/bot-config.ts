/**
 * Bot Configuration Module
 * Handles environment setup, validation, and client initialization
 */

import { Client, GatewayIntentBits } from "discord.js";

export const isDev = process.env.NODE_ENV === "development";

/**
 * Load and validate Supabase configuration
 */
export function initializeSupabaseConfig(): {
  supabaseUrl: string;
  supabaseKey: string;
} {
  const supabaseUrl = isDev
    ? process.env.SUPABASE_URL_LOCAL || "http://127.0.0.1:54321"
    : process.env.SUPABASE_URL!;
  const supabaseKey = isDev
    ? process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL!
    : process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      `Missing Supabase credentials for ${isDev ? "local" : "cloud"} environment`,
    );
  }

  console.log(
    `[Bot] Connected to ${isDev ? "local" : "cloud"} Supabase: ${supabaseUrl}`,
  );

  return { supabaseUrl, supabaseKey };
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
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
}

/**
 * Get HTTP port for the bot server
 */
export function getHttpPort(): number {
  return isDev ? 3001 : parseInt(process.env.HTTP_PORT || "3001");
}
