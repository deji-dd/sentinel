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

const supabaseUrl = requireEnv("SUPABASE_URL");
const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const discordToken = requireEnv("DISCORD_BOT_TOKEN");

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
