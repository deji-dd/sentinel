import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { executeTravel } from "./commands/travel.js";
import * as setupCommand from "./commands/setup.js";
import * as settingsCommand from "./commands/settings.js";
import * as travelSettings from "./commands/settings-travel.js";
import * as accountSettings from "./commands/settings-account.js";
import * as searchCommand from "./commands/search.js";
import { initHttpServer } from "./lib/http-server.js";

// Use local Supabase in development, cloud in production
const isDev = process.env.NODE_ENV === "development";
const supabaseUrl = isDev
  ? process.env.SUPABASE_URL_LOCAL || "http://127.0.0.1:54321"
  : process.env.SUPABASE_URL!;
const supabaseKey = isDev
  ? process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL!
  : process.env.SUPABASE_SERVICE_ROLE_KEY!;
const discordToken = isDev
  ? process.env.DISCORD_BOT_TOKEN_LOCAL!
  : process.env.DISCORD_BOT_TOKEN!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    `Missing Supabase credentials for ${isDev ? "local" : "cloud"} environment`,
  );
}

if (!discordToken) {
  throw new Error(
    `Missing Discord bot token for ${isDev ? "local" : "cloud"} environment`,
  );
}

console.log(
  `[Bot] Connected to ${isDev ? "local" : "cloud"} Supabase: ${supabaseUrl}`,
);
console.log(
  `[Bot] Using ${isDev ? "local" : "production"} Discord bot instance`,
);

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot is online as ${readyClient.user.tag}`);

  // Start HTTP server for worker communication
  const httpPort = isDev ? 3001 : parseInt(process.env.HTTP_PORT || "3001");
  initHttpServer(client, supabase, httpPort);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Handle chat input commands
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "travel") {
      await executeTravel(interaction, supabase);
    } else if (interaction.commandName === "setup") {
      await setupCommand.execute(interaction, supabase);
    } else if (interaction.commandName === "settings") {
      await settingsCommand.execute(interaction, supabase);
    } else if (interaction.commandName === "search") {
      await searchCommand.execute(interaction, supabase);
    }
    return;
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (interaction.customId === "setup-modal") {
      await setupCommand.handleModalSubmit(interaction, supabase);
    } else if (interaction.customId === "account_settings_modal") {
      await accountSettings.handleAccountSettingsModal(interaction, supabase);
    } else if (interaction.customId === "modal_alert_cooldown") {
      await travelSettings.handleModalAlertCooldown(interaction, supabase);
    } else if (interaction.customId === "modal_min_profit_trip") {
      await travelSettings.handleModalMinProfitTrip(interaction, supabase);
    } else if (interaction.customId === "modal_min_profit_minute") {
      await travelSettings.handleModalMinProfitMinute(interaction, supabase);
    } else if (interaction.customId === "modal_blacklisted_items") {
      await travelSettings.handleModalBlacklistedItems(interaction, supabase);
    } else if (interaction.customId === "modal_blacklisted_categories") {
      await travelSettings.handleModalBlacklistedCategories(
        interaction,
        supabase,
      );
    }
    return;
  }

  // Handle string select menus
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "settings_module_select") {
      const selectedModule = interaction.values[0];

      if (selectedModule === "travel") {
        await travelSettings.handleTravelSettings(interaction, supabase);
      } else if (selectedModule === "account") {
        await accountSettings.handleAccountSettings(interaction, supabase);
      }
    } else if (interaction.customId === "travel_setting_select") {
      await travelSettings.handleTravelSettingSelect(interaction, supabase);
    }
    return;
  }
});

await client.login(discordToken);
