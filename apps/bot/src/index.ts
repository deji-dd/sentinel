import "dotenv/config";
import { Client, Events, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as financeCommand from "./commands/personal/finance.js";
import * as financeSettingsCommand from "./commands/personal/finance-settings.js";
import * as forceRunCommand from "./commands/personal/force-run.js";
import * as deployCommandsCommand from "./commands/personal/deploy-commands.js";
import * as setupGuildCommand from "./commands/personal/setup-guild.js";
import * as verifyCommand from "./commands/general/verify.js";
import { initHttpServer } from "./lib/http-server.js";
import { getAuthorizedDiscordUserId } from "./lib/auth.js";
import { TABLE_NAMES } from "@sentinel/shared";

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

const authorizedDiscordUserId = getAuthorizedDiscordUserId();

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
  try {
    // Handle chat input commands
    if (interaction.isChatInputCommand()) {
      // Admin-only commands bypass guild initialization check
      if (interaction.commandName === "force-run") {
        if (interaction.user.id !== authorizedDiscordUserId) {
          if (interaction.isRepliable()) {
            const errorEmbed = new EmbedBuilder()
              .setColor(0xef4444)
              .setTitle("❌ Not Authorized")
              .setDescription("You are not authorized to use this command.");
            await interaction.reply({
              embeds: [errorEmbed],
            });
          }
          return;
        }
        await forceRunCommand.execute(interaction, supabase);
      } else if (interaction.commandName === "deploy-commands") {
        if (interaction.user.id !== authorizedDiscordUserId) {
          if (interaction.isRepliable()) {
            const errorEmbed = new EmbedBuilder()
              .setColor(0xef4444)
              .setTitle("❌ Not Authorized")
              .setDescription("You are not authorized to use this command.");
            await interaction.reply({
              embeds: [errorEmbed],
            });
          }
          return;
        }
        await deployCommandsCommand.execute(interaction, supabase, client);
      } else if (interaction.commandName === "setup-guild") {
        if (interaction.user.id !== authorizedDiscordUserId) {
          if (interaction.isRepliable()) {
            const errorEmbed = new EmbedBuilder()
              .setColor(0xef4444)
              .setTitle("❌ Not Authorized")
              .setDescription("You are not authorized to use this command.");
            await interaction.reply({
              embeds: [errorEmbed],
            });
          }
          return;
        }
        await setupGuildCommand.execute(interaction, supabase, client);
      } else {
        // Regular commands (personal commands only exist in admin guild)
        if (interaction.commandName === "finance") {
          await financeCommand.execute(interaction, supabase);
        } else if (interaction.commandName === "finance-settings") {
          await financeSettingsCommand.execute(interaction);
        } else if (interaction.commandName === "verify") {
          await verifyCommand.execute(interaction);
        }
      }
      return;
    }

    // Handle string select menus
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "setup_guild_select") {
        await setupGuildCommand.handleGuildSelect(interaction, supabase);
      } else if (interaction.customId.startsWith("setup_modules_select")) {
        await setupGuildCommand.handleModulesSelect(interaction, supabase);
      }
      return;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected bot error";

    console.error("Bot interaction error:", error);

    if (!interaction.isRepliable()) {
      return;
    }

    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(message);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed] });
    } else {
      await interaction.reply({ embeds: [errorEmbed] });
    }
  }
});

await client.login(discordToken);
