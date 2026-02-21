import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as financeCommand from "./commands/personal/finance/finance.js";
import * as financeSettingsCommand from "./commands/personal/finance/finance-settings.js";
import * as forceRunCommand from "./commands/personal/admin/force-run.js";
import * as deployCommandsCommand from "./commands/personal/admin/deploy-commands.js";
import * as setupGuildCommand from "./commands/personal/admin/setup-guild.js";
import * as teardownGuildCommand from "./commands/personal/admin/teardown-guild.js";
import * as addBotCommand from "./commands/personal/admin/add-bot.js";
import * as enableModuleCommand from "./commands/personal/admin/enable-module.js";
import * as guildStatusCommand from "./commands/personal/admin/guild-status.js";
import * as verifyCommand from "./commands/general/verification/verify.js";
import * as verifyallCommand from "./commands/general/verification/verifyall.js";
import * as configCommand from "./commands/general/admin/config.js";
import { initHttpServer } from "./lib/http-server.js";
import { getAuthorizedDiscordUserId } from "./lib/auth.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { GuildSyncScheduler } from "./lib/verification-sync.js";
import { getNextApiKey, resolveApiKeysForGuild } from "./lib/api-keys.js";

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

async function logCommandAudit(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    const options = interaction.options.data.map((option) => {
      const value = option.value;
      const safeValue =
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
          ? value
          : value
            ? String(value)
            : null;
      return { name: option.name, value: safeValue };
    });

    await supabase.from(TABLE_NAMES.GUILD_AUDIT).insert({
      guild_id: interaction.guildId ?? "dm",
      actor_discord_id: interaction.user.id,
      action: "command_invoked",
      details: {
        command: interaction.commandName,
        options,
      },
    });
  } catch (error) {
    console.warn("Failed to write command audit entry:", error);
  }
}

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
      await logCommandAudit(interaction);
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
      } else if (interaction.commandName === "add-bot") {
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
        await addBotCommand.execute(interaction, supabase);
      } else if (interaction.commandName === "teardown-guild") {
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
        await teardownGuildCommand.execute(interaction, supabase, client);
      } else if (interaction.commandName === "enable-module") {
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
        await enableModuleCommand.execute(interaction, supabase, client);
      } else if (interaction.commandName === "guild-status") {
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
        await guildStatusCommand.execute(interaction, supabase, client);
      } else if (interaction.commandName === "test-verification-dms") {
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
      if (interaction.customId === "config_back_to_menu") {
        await configCommand.handleBackToMenu(interaction, supabase);
      } else if (interaction.customId === "config_back_verify_settings") {
        await configCommand.handleBackToVerifySettings(interaction, supabase);
      } else if (interaction.customId === "config_back_admin_settings") {
        await configCommand.handleBackToAdminSettings(interaction, supabase);
      } else if (interaction.customId === "config_edit_api_keys") {
        await configCommand.handleEditApiKeysButton(interaction, supabase);
      } else if (interaction.customId === "config_add_api_key") {
        await configCommand.handleAddApiKeyButton(interaction);
      } else if (interaction.customId === "config_rotate_api_key") {
        await configCommand.handleRotateApiKeyButton(interaction, supabase);
      } else if (interaction.customId === "config_remove_api_key_menu") {
        await configCommand.handleRemoveApiKeyMenuButton(interaction, supabase);
      } else if (interaction.customId === "config_add_faction_role") {
        await configCommand.handleAddFactionRoleButton(interaction);
      } else if (interaction.customId === "config_remove_faction_role") {
        await configCommand.handleRemoveFactionRoleButton(interaction);
      } else if (interaction.customId === "confirm_auto_verify_toggle") {
        await configCommand.handleConfirmAutoVerifyToggle(
          interaction,
          supabase,
        );
      } else if (interaction.customId === "verify_settings_edit_cancel") {
        await configCommand.handleVerifySettingsEditCancel(
          interaction,
          supabase,
        );
      }
      return;
    }

    // Handle modals
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("config_add_api_key_modal")) {
        await configCommand.handleAddApiKeyModalSubmit(interaction, supabase);
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
      } else if (interaction.customId === "teardown_guild_select") {
        await teardownGuildCommand.handleTeardownGuildSelect(
          interaction,
          supabase,
          client,
        );
      } else if (interaction.customId === "enable_module_guild_select") {
        await enableModuleCommand.handleGuildSelect(interaction, supabase);
      } else if (interaction.customId.startsWith("enable_module_toggle")) {
        await enableModuleCommand.handleModuleToggle(
          interaction,
          supabase,
          client,
        );
      } else if (interaction.customId === "config_view_select") {
        await configCommand.handleViewSelect(interaction, supabase);
      } else if (interaction.customId === "verify_settings_edit") {
        await configCommand.handleVerifySettingsEdit(interaction, supabase);
      } else if (interaction.customId === "config_remove_api_key_select") {
        await configCommand.handleRemoveApiKeySelect(interaction, supabase);
      }
      return;
    }

    // Handle role select menus
    if (interaction.isRoleSelectMenu()) {
      if (interaction.customId.startsWith("config_faction_role_select_")) {
        await configCommand.handleFactionRoleSelect(interaction, supabase);
      } else if (interaction.customId === "config_verified_role_select") {
        await configCommand.handleVerifiedRoleSelect(interaction, supabase);
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

// Auto-verify new members when they join and send DM with results
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
      .select(
        "auto_verify, api_keys, api_key, nickname_template, verified_role_id",
      )
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

    const { keys: apiKeys, error: apiKeyError } = resolveApiKeysForGuild(
      guildId,
      guildConfig,
    );

    if (apiKeyError) {
      // No usable API keys configured, skip
      return;
    }

    // Try to verify the user
    let verificationResult: {
      status: "success" | "not_linked" | "error";
      title: string;
      description: string;
      color: number;
      data?: {
        name: string;
        id: number;
        faction?: { name: string; tag: string };
      };
      errorMessage?: string;
    } | null = null;

    try {
      const { botTornApi } = await import("./lib/torn-api.js");
      const apiKey = getNextApiKey(guildId, apiKeys);
      const response = await botTornApi.get(`/user/${member.id}`, {
        apiKey,
        queryParams: { selections: "discord,faction" },
      });

      if (response.error) {
        if (response.error.code === 6) {
          // User not linked to Torn
          verificationResult = {
            status: "not_linked",
            title: "❌ Not Linked to Torn",
            description: `Your Discord account is not linked to a Torn account.`,
            color: 0xef4444,
            errorMessage:
              "This Discord account is not linked to any Torn account",
          };
          console.log(
            `[Auto-Verify] User ${member.user.username} (${member.id}) not linked to Torn`,
          );
        } else {
          // API error
          verificationResult = {
            status: "error",
            title: "❌ Verification Failed",
            description: `An error occurred while verifying your account: **${response.error.error || "Unknown error"}**. Please try the /verify command manually.`,
            color: 0xef4444,
            errorMessage: `Torn API error: ${response.error.error}`,
          };
          console.error(
            `[Auto-Verify] Torn API error for ${member.id}:`,
            response.error.error,
          );
        }
      } else if (response.discord) {
        // Successfully verified
        await supabase.from(TABLE_NAMES.VERIFIED_USERS).upsert({
          discord_id: member.id,
          torn_player_id: response.player_id,
          torn_player_name: response.name,
          faction_id: response.faction?.faction_id || null,
          faction_name: response.faction?.faction_name || null,
          verified_at: new Date().toISOString(),
        });

        verificationResult = {
          status: "success",
          title: "✅ Automatically Verified",
          description: `Welcome to **${member.guild.name}**! You've been automatically verified.`,
          color: 0x22c55e,
          data: {
            name: response.name,
            id: response.player_id,
            faction: response.faction
              ? {
                  name: response.faction.faction_name,
                  tag: response.faction.faction_tag,
                }
              : undefined,
          },
        };

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

        // Assign verification role if configured
        if (guildConfig.verified_role_id) {
          try {
            await member.roles.add(guildConfig.verified_role_id);
            console.log(
              `[Auto-Verify] Assigned verification role to ${member.user.username}`,
            );
          } catch (roleError) {
            console.error(
              `[Auto-Verify] Failed to assign verification role to ${member.user.username}:`,
              roleError,
            );
          }
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
      } else {
        // Discord not linked but other data present (shouldn't happen)
        verificationResult = {
          status: "error",
          title: "❌ Verification Failed",
          description:
            "Your account exists but verification failed. Please try the /verify command manually.",
          color: 0xef4444,
          errorMessage: "Discord not linked to account",
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      verificationResult = {
        status: "error",
        title: "❌ Verification Failed",
        description: `An unexpected error occurred. Please try the /verify command manually. (${errorMessage})`,
        color: 0xef4444,
        errorMessage,
      };
      console.error(
        `[Auto-Verify] Error verifying ${member.user.username} (${member.id}):`,
        error,
      );
    }

    // Send DM with verification results
    if (verificationResult) {
      try {
        const resultEmbed = new EmbedBuilder()
          .setColor(verificationResult.color)
          .setTitle(verificationResult.title)
          .setDescription(verificationResult.description);

        if (verificationResult.data) {
          resultEmbed.addFields(
            {
              name: "Torn Name",
              value: verificationResult.data.name,
              inline: true,
            },
            {
              name: "Torn ID",
              value: verificationResult.data.id.toString(),
              inline: true,
            },
            {
              name: "Faction",
              value: verificationResult.data.faction?.name || "None",
              inline: true,
            },
          );
        }

        await member.send({ embeds: [resultEmbed] });
        console.log(
          `[Auto-Verify] Sent ${verificationResult.status} DM to ${member.user.username}`,
        );
      } catch (dmError) {
        // User has DMs disabled or blocked the bot
        console.log(
          `[Auto-Verify] Could not send DM to ${member.user.username}:`,
          dmError instanceof Error ? dmError.message : String(dmError),
        );
      }
    }
  } catch (error) {
    console.error("[Auto-Verify] Unexpected error:", error);
  }
});

await client.login(discordToken);
