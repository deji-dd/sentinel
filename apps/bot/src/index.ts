import "dotenv/config";
import { Client, Events, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as financeCommand from "./commands/personal/finance.js";
import * as financeSettingsCommand from "./commands/personal/finance-settings.js";
import * as forceRunCommand from "./commands/personal/force-run.js";
import * as deployCommandsCommand from "./commands/personal/deploy-commands.js";
import * as setupGuildCommand from "./commands/personal/setup-guild.js";
import * as verifyCommand from "./commands/general/verify.js";
import * as verifyallCommand from "./commands/general/verifyall.js";
import * as configCommand from "./commands/general/config.js";
import { initHttpServer } from "./lib/http-server.js";
import { getAuthorizedDiscordUserId } from "./lib/auth.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { GuildSyncScheduler } from "./lib/verification-sync.js";

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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot is online as ${readyClient.user.tag}`);

  // Start HTTP server for worker communication
  const httpPort = isDev ? 3001 : parseInt(process.env.HTTP_PORT || "3001");
  initHttpServer(client, supabase, httpPort);

  // Start periodic guild sync scheduler
  const guildSyncScheduler = new GuildSyncScheduler(client, supabase);
  guildSyncScheduler.start();
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
          await verifyCommand.execute(interaction, supabase);
        } else if (interaction.commandName === "verifyall") {
          await verifyallCommand.execute(interaction, supabase);
        } else if (interaction.commandName === "config") {
          await configCommand.execute(interaction, supabase);
        }
      }
      return;
    }

    // Handle buttons
    if (interaction.isButton()) {
      if (interaction.customId === "config_edit_api_key") {
        await configCommand.handleSetApiKeyButton(interaction);
      } else if (interaction.customId === "config_edit_nickname") {
        await configCommand.handleEditNicknameButton(interaction);
      } else if (interaction.customId === "config_edit_sync_interval") {
        await configCommand.handleEditSyncIntervalButton(interaction);
      } else if (interaction.customId === "config_toggle_auto_verify") {
        await configCommand.handleToggleAutoVerifyButton(interaction, supabase);
      } else if (interaction.customId === "config_add_faction_role") {
        await configCommand.handleAddFactionRoleButton(interaction);
      } else if (interaction.customId === "config_remove_faction_role") {
        await configCommand.handleRemoveFactionRoleButton(interaction);
      }
      return;
    }

    // Handle modals
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "config_api_key_modal") {
        await configCommand.handleApiKeyModalSubmit(interaction, supabase);
      } else if (interaction.customId === "config_nickname_template_modal") {
        await configCommand.handleNicknameTemplateModalSubmit(
          interaction,
          supabase,
        );
      } else if (interaction.customId === "config_sync_interval_modal") {
        await configCommand.handleSyncIntervalModalSubmit(
          interaction,
          supabase,
        );
      } else if (interaction.customId === "config_add_faction_role_modal") {
        await configCommand.handleAddFactionRoleModalSubmit(
          interaction,
          supabase,
        );
      } else if (interaction.customId === "config_remove_faction_role_modal") {
        await configCommand.handleRemoveFactionRoleModalSubmit(
          interaction,
          supabase,
        );
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

    // Handle role select menus
    if (interaction.isRoleSelectMenu()) {
      if (interaction.customId.startsWith("config_faction_role_select_")) {
        await configCommand.handleFactionRoleSelect(interaction, supabase);
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

// Auto-verify new members when they join
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    // Skip bots
    if (member.user.bot) {
      return;
    }

    const guildId = member.guild.id;

    // Get guild config to check if auto-verify is enabled
    const { data: guildConfig, error: configError } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("auto_verify, api_key, nickname_template")
      .eq("guild_id", guildId)
      .single();

    if (configError || !guildConfig) {
      // Guild not configured, skip
      return;
    }

    if (!guildConfig.auto_verify) {
      // Auto-verify not enabled for this guild
      return;
    }

    if (!guildConfig.api_key) {
      // No API key configured, can't verify
      return;
    }

    // Decrypt the API key
    let apiKey: string;
    try {
      const { decrypt } = await import("./lib/encryption.js");
      apiKey = decrypt(guildConfig.api_key);
    } catch (error) {
      console.error("[Auto-Verify] Failed to decrypt API key:", error);
      return;
    }

    // Try to verify the user
    try {
      const { botTornApi } = await import("./lib/torn-api.js");
      const response = await botTornApi.get(`/user/${member.id}`, {
        apiKey,
        queryParams: { selections: "discord,faction" },
      });

      if (response.error) {
        if (response.error.code === 6) {
          // User not linked to Torn, that's okay
          console.log(
            `[Auto-Verify] User ${member.user.username} (${member.id}) not linked to Torn`,
          );
        } else {
          console.error(
            `[Auto-Verify] Torn API error for ${member.id}:`,
            response.error.error,
          );
        }
        return;
      }

      if (response.discord) {
        // Successfully verified - store in database
        await supabase.from(TABLE_NAMES.VERIFIED_USERS).upsert({
          discord_id: member.id,
          torn_player_id: response.player_id,
          torn_player_name: response.name,
          faction_id: response.faction?.faction_id || null,
          faction_name: response.faction?.faction_name || null,
          verified_at: new Date().toISOString(),
        });

        console.log(
          `[Auto-Verify] Successfully verified ${member.user.username} (${member.id}) as ${response.name} [${response.player_id}]`,
        );

        // Apply nickname template
        try {
          const nickname = guildConfig.nickname_template
            .replace("{name}", response.name)
            .replace("{id}", response.player_id.toString())
            .replace("{tag}", response.faction?.faction_tag || "");

          await member.setNickname(nickname);
          console.log(
            `[Auto-Verify] Set nickname for ${member.user.username}: ${nickname}`,
          );
        } catch (nicknameError) {
          console.error(
            `[Auto-Verify] Failed to set nickname for ${member.user.username}:`,
            nicknameError,
          );
        }

        // Assign faction role if mapping exists
        if (response.faction?.faction_id) {
          const { data: factionRole } = await supabase
            .from(TABLE_NAMES.FACTION_ROLES)
            .select("role_ids")
            .eq("guild_id", guildId)
            .eq("faction_id", response.faction.faction_id)
            .single();

          if (factionRole && factionRole.role_ids.length > 0) {
            try {
              await member.roles.add(factionRole.role_ids);
              console.log(
                `[Auto-Verify] Assigned ${factionRole.role_ids.length} role(s) to ${member.user.username}`,
              );
            } catch (roleError) {
              console.error(
                `[Auto-Verify] Failed to assign roles to ${member.user.username}:`,
                roleError,
              );
            }
          }
        }

        // Optionally send a welcome DM to the user
        try {
          const welcomeEmbed = new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("✅ Automatically Verified")
            .setDescription(
              `Welcome to **${member.guild.name}**! You've been automatically verified.`,
            )
            .addFields(
              { name: "Torn Name", value: response.name, inline: true },
              {
                name: "Torn ID",
                value: response.player_id.toString(),
                inline: true,
              },
              {
                name: "Faction",
                value: response.faction?.faction_name || "None",
                inline: true,
              },
            );

          await member.send({ embeds: [welcomeEmbed] });
        } catch (dmError) {
          // User has DMs disabled or blocked the bot, that's okay
          console.log(
            `[Auto-Verify] Could not send DM to ${member.user.username}`,
          );
        }
      }
    } catch (error) {
      console.error(
        `[Auto-Verify] Error verifying ${member.user.username} (${member.id}):`,
        error,
      );
    }
  } catch (error) {
    console.error("[Auto-Verify] Unexpected error:", error);
  }
});

await client.login(discordToken);
