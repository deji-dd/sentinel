import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { executeTravel } from "./commands/travel.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// Use local Supabase in development, cloud in production
const isDev = process.env.NODE_ENV === "development";
const supabaseUrl = isDev
  ? process.env.SUPABASE_URL_LOCAL || "http://127.0.0.1:54321"
  : requireEnv("SUPABASE_URL");
const supabaseKey = isDev
  ? requireEnv("SUPABASE_SERVICE_ROLE_KEY_LOCAL")
  : requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const discordToken = requireEnv("DISCORD_BOT_TOKEN");

console.log(
  `[Bot] Connected to ${isDev ? "local" : "cloud"} Supabase: ${supabaseUrl}`,
);

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot is online as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "travel") {
    await executeTravel(interaction, supabase);
  }
});

await client.login(discordToken);
