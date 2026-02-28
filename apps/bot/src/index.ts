import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
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
import * as assaultCheckCommand from "./commands/general/territories/assault-check.js";
import * as burnMapCommand from "./commands/general/territories/burn-map.js";
import * as burnMapSimulatorCommand from "./commands/general/territories/burn-map-simulator.js";
import { initHttpServer } from "./lib/http-server.js";
import { getAuthorizedDiscordUserId } from "../.archive/auth.js";
import { logGuildSuccess, logGuildError } from "./lib/guild-logger.js";
import { TABLE_NAMES, getNextApiKey } from "@sentinel/shared";
import { GuildSyncScheduler } from "./lib/verification-sync.js";
import { WarTrackerScheduler } from "./lib/war-tracker-scheduler.js";
import { getGuildApiKeys } from "./lib/guild-api-keys.js";
import { type TornApiComponents } from "@sentinel/shared";
import { supabase } from "./lib/supabase.js";
import { tornApi } from "./services/torn-client.js";

type UserGenericResponse = TornApiComponents["schemas"]["UserDiscordResponse"] &
  TornApiComponents["schemas"]["UserFactionResponse"] &
  TornApiComponents["schemas"]["UserProfileResponse"];

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
  initHttpServer(client, httpPort);

  // Start periodic guild sync scheduler
  const guildSyncScheduler = new GuildSyncScheduler(client);
  guildSyncScheduler.start();

  const warTrackerScheduler = new WarTrackerScheduler(client);
  warTrackerScheduler.start();
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
        await forceRunCommand.execute(interaction);
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
        await deployCommandsCommand.execute(interaction, client);
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
        await setupGuildCommand.execute(interaction, client);
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
        await addBotCommand.execute(interaction);
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
        await teardownGuildCommand.execute(interaction, client);
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
        await enableModuleCommand.execute(interaction, client);
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
        await guildStatusCommand.execute(interaction, client);
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
          await financeCommand.execute(interaction);
        } else if (interaction.commandName === "finance-settings") {
          await financeSettingsCommand.execute(interaction);
        } else if (interaction.commandName === "verify") {
          await verifyCommand.execute(interaction);
        } else if (interaction.commandName === "verifyall") {
          await verifyallCommand.execute(interaction);
        } else if (interaction.commandName === "config") {
          await configCommand.execute(interaction);
        } else if (interaction.commandName === "assault-check") {
          await assaultCheckCommand.execute(interaction);
        } else if (interaction.commandName === "burn-map") {
          await burnMapCommand.execute(interaction);
        } else if (interaction.commandName === "burn-map-simulator") {
          await burnMapSimulatorCommand.execute(interaction);
        }
      }
      return;
    }

    // Handle buttons
    if (interaction.isButton()) {
      if (interaction.customId === "config_back_to_menu") {
        await configCommand.handleBackToMenu(interaction);
      } else if (interaction.customId === "config_back_verify_settings") {
        await configCommand.handleBackToVerifySettings(interaction);
      } else if (interaction.customId === "config_back_admin_settings") {
        await configCommand.handleBackToAdminSettings(interaction);
      } else if (interaction.customId === "config_edit_api_keys") {
        await configCommand.handleEditApiKeysButton(interaction);
      } else if (interaction.customId === "config_edit_log_channel") {
        await configCommand.handleEditLogChannelButton(interaction);
      } else if (interaction.customId === "config_clear_log_channel") {
        await configCommand.handleClearLogChannel(interaction);
      } else if (interaction.customId === "config_edit_admin_roles") {
        await configCommand.handleEditAdminRolesButton(interaction);
      } else if (interaction.customId === "config_add_api_key") {
        await configCommand.handleAddApiKeyButton(interaction);
      } else if (interaction.customId === "config_rotate_api_key") {
        await configCommand.handleRotateApiKeyButton(interaction);
      } else if (interaction.customId === "config_remove_api_key_menu") {
        await configCommand.handleRemoveApiKeyMenuButton(interaction);
      } else if (interaction.customId === "config_add_faction_role") {
        await configCommand.handleAddFactionRoleButton(interaction);
      } else if (interaction.customId === "config_remove_faction_role") {
        await configCommand.handleRemoveFactionRoleButton(interaction);
      } else if (interaction.customId === "config_faction_manage_back") {
        await configCommand.handleFactionManageBack(interaction);
      } else if (interaction.customId.startsWith("config_faction_toggle_")) {
        await configCommand.handleFactionToggle(interaction);
      } else if (
        interaction.customId.startsWith("config_faction_member_roles_")
      ) {
        await configCommand.handleFactionMemberRolesButton(interaction);
      } else if (
        interaction.customId.startsWith("config_faction_leader_roles_")
      ) {
        await configCommand.handleFactionLeaderRolesButton(interaction);
      } else if (interaction.customId === "confirm_auto_verify_toggle") {
        await configCommand.handleConfirmAutoVerifyToggle(interaction);
      } else if (interaction.customId === "verify_settings_edit_cancel") {
        await configCommand.handleVerifySettingsEditCancel(interaction);
      } else if (interaction.customId === "tt_settings_show") {
        await configCommand.handleShowTTSettings(interaction);
      } else if (interaction.customId === "tt_full_channel_clear") {
        await configCommand.handleTTFullChannelClear(interaction);
      } else if (interaction.customId === "tt_filtered_channel_clear") {
        await configCommand.handleTTFilteredChannelClear(interaction);
      } else if (
        interaction.customId.startsWith("tt_war_track_page_prev") ||
        interaction.customId.startsWith("tt_war_track_page_next")
      ) {
        await configCommand.handleTTWarTrackPage(interaction);
      } else if (interaction.customId.startsWith("tt_war_track_back")) {
        await configCommand.handleTTWarTrackBack(interaction);
      } else if (
        interaction.customId.startsWith("tt_war_track_channel_clear")
      ) {
        await configCommand.handleTTWarTrackChannelClear(interaction);
      } else if (interaction.customId.startsWith("tt_war_track_away_filter")) {
        await configCommand.handleTTWarTrackAwayFilterButton(interaction);
      }
      return;
    }

    // Handle modals
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("config_add_api_key_modal")) {
        await configCommand.handleAddApiKeyModalSubmit(interaction);
      } else if (interaction.customId === "config_nickname_template_modal") {
        await configCommand.handleNicknameTemplateModalSubmit(interaction);
      } else if (interaction.customId === "config_sync_interval_modal") {
        await configCommand.handleSyncIntervalModalSubmit(interaction);
      } else if (interaction.customId === "config_add_faction_role_modal") {
        await configCommand.handleAddFactionRoleModalSubmit(interaction);
      } else if (interaction.customId === "config_remove_faction_role_modal") {
        await configCommand.handleRemoveFactionRoleModalSubmit(interaction);
      } else if (interaction.customId === "tt_edit_territories_modal") {
        await configCommand.handleTTEditTerritoriesModalSubmit(interaction);
      } else if (interaction.customId === "tt_edit_factions_modal") {
        await configCommand.handleTTEditFactionsModalSubmit(interaction);
      } else if (interaction.customId.startsWith("tt_war_track_away_modal")) {
        await configCommand.handleTTWarTrackAwayFilterSubmit(interaction);
      }
      return;
    }

    // Handle string select menus
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "setup_guild_select") {
        await setupGuildCommand.handleGuildSelect(interaction);
      } else if (interaction.customId.startsWith("setup_modules_select")) {
        await setupGuildCommand.handleModulesSelect(interaction);
      } else if (interaction.customId === "teardown_guild_select") {
        await teardownGuildCommand.handleTeardownGuildSelect(
          interaction,
          client,
        );
      } else if (interaction.customId === "enable_module_guild_select") {
        await enableModuleCommand.handleGuildSelect(interaction);
      } else if (interaction.customId.startsWith("enable_module_toggle")) {
        await enableModuleCommand.handleModuleToggle(interaction, client);
      } else if (interaction.customId === "config_view_select") {
        await configCommand.handleViewSelect(interaction);
      } else if (interaction.customId === "verify_settings_edit") {
        await configCommand.handleVerifySettingsEdit(interaction);
      } else if (interaction.customId === "config_remove_api_key_select") {
        await configCommand.handleRemoveApiKeySelect(interaction);
      } else if (interaction.customId === "config_faction_manage_select") {
        await configCommand.handleFactionManageSelect(interaction);
      } else if (interaction.customId === "tt_settings_edit") {
        await configCommand.handleTTSettingsEdit(interaction);
      } else if (interaction.customId === "tt_filtered_settings_edit") {
        await configCommand.handleTTFilteredSettingsEdit(interaction);
      } else if (interaction.customId === "tt_notification_type_select") {
        await configCommand.handleTTNotificationTypeSelect(interaction);
      } else if (interaction.customId.startsWith("tt_war_track_select")) {
        await configCommand.handleTTWarTrackSelect(interaction);
      } else if (interaction.customId.startsWith("tt_war_track_enemy_side")) {
        await configCommand.handleTTWarTrackEnemySideSelect(interaction);
      }
      return;
    }

    // Handle role select menus
    if (interaction.isRoleSelectMenu()) {
      if (interaction.customId.startsWith("config_faction_role_select_")) {
        await configCommand.handleFactionRoleSelect(interaction);
      } else if (
        interaction.customId.startsWith("config_faction_member_roles_select_")
      ) {
        await configCommand.handleFactionMemberRolesSelect(interaction);
      } else if (
        interaction.customId.startsWith("config_faction_leader_roles_select_")
      ) {
        await configCommand.handleFactionLeaderRolesSelect(interaction);
      } else if (interaction.customId === "config_verified_role_select") {
        await configCommand.handleVerifiedRoleSelect(interaction);
      } else if (interaction.customId === "config_admin_roles_select") {
        await configCommand.handleAdminRolesSelect(interaction);
      }
      return;
    }

    // Handle channel select menus
    if (interaction.isChannelSelectMenu()) {
      if (interaction.customId === "config_log_channel_select") {
        await configCommand.handleLogChannelSelect(interaction);
      } else if (interaction.customId === "tt_full_channel_select") {
        await configCommand.handleTTFullChannelSelect(interaction);
      } else if (interaction.customId === "tt_filtered_channel_select") {
        await configCommand.handleTTFilteredChannelSelect(interaction);
      } else if (
        interaction.customId.startsWith("tt_war_track_channel_select")
      ) {
        await configCommand.handleTTWarTrackChannelSelect(interaction);
      }
      return;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected bot error";

    console.error("Bot interaction error:", error);

    if (interaction.guildId) {
      await logGuildError(
        interaction.guildId,
        client,

        "Command Error",
        error instanceof Error ? error : message,
        `Error handling interaction ${interaction.id}.`,
      );
    }

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
      .select("auto_verify, nickname_template, verified_role_id")
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

    // Get API keys from new guild-api-keys table
    const apiKeys = await getGuildApiKeys(guildId);

    if (apiKeys.length === 0) {
      // No API keys configured for this guild, skip
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
      const apiKey = getNextApiKey(guildId, apiKeys);

      const response = await tornApi.get<UserGenericResponse>(`/user`, {
        apiKey,
        queryParams: {
          selections: ["discord", "faction", "profile"],
          id: member.id,
        },
      });

      if (response.discord) {
        // Validate that required fields exist in response
        if (!response.profile?.id || !response.profile?.name) {
          verificationResult = {
            status: "error",
            title: "❌ Verification Failed",
            description: `An error occurred while verifying your account: incomplete response from Torn API. Please try the /verify command manually.`,
            color: 0xef4444,
            errorMessage: `Torn API returned incomplete data: player_id=${response.profile?.id}, name=${response.profile?.name}`,
          };
        } else {
          // Successfully verified with complete data
          await supabase.from(TABLE_NAMES.VERIFIED_USERS).upsert({
            discord_id: member.id,
            torn_player_id: response.profile.id,
            torn_player_name: response.profile.name,
            faction_id: response.faction?.id || null,
            faction_name: response.faction?.name || null,
            verified_at: new Date().toISOString(),
          });

          verificationResult = {
            status: "success",
            title: "✅ Automatically Verified",
            description: `Welcome to **${member.guild.name}**! You've been automatically verified.`,
            color: 0x22c55e,
            data: {
              name: response.profile.name,
              id: response.profile.id,
              faction: response.faction
                ? {
                    name: response.faction.name,
                    tag: response.faction.tag,
                  }
                : undefined,
            },
          };

          // Track roles assigned
          const rolesAdded: string[] = [];
          const rolesFailed: string[] = [];

          // Apply nickname template
          try {
            const nickname = guildConfig.nickname_template
              .replace("{name}", response.profile.name)
              .replace("{id}", response.profile.id.toString())
              .replace("{tag}", response.faction?.tag || "");

            await member.setNickname(nickname);
          } catch (nicknameError) {
            console.error(
              `[Auto-Verify] Failed to set nickname for ${member.user.username}:`,
              nicknameError,
            );
            await logGuildError(
              guildId,
              client,

              "Auto-Verify: Nickname Failed",
              nicknameError instanceof Error
                ? nicknameError
                : String(nicknameError),
              `Failed to set nickname for ${member.user}.`,
            );
          }

          // Assign verification role if configured
          if (guildConfig.verified_role_id) {
            try {
              await member.roles.add(guildConfig.verified_role_id);
              rolesAdded.push(guildConfig.verified_role_id);
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (roleError) {
              rolesFailed.push(guildConfig.verified_role_id);
            }
          }

          // Assign faction role if mapping exists
          if (response.faction?.id) {
            const { data: factionRole } = await supabase
              .from(TABLE_NAMES.FACTION_ROLES)
              .select("role_ids")
              .eq("guild_id", guildId)
              .eq("faction_id", response.faction.id)
              .single();

            if (factionRole && factionRole.role_ids.length > 0) {
              try {
                await member.roles.add(factionRole.role_ids);
                rolesAdded.push(...factionRole.role_ids);
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
              } catch (roleError) {
                rolesFailed.push(...factionRole.role_ids);
              }
            }
          }

          // Build guild log fields
          const logFields: Array<{
            name: string;
            value: string;
            inline: boolean;
          }> = [
            { name: "Discord ID", value: member.id, inline: true },
            {
              name: "Torn ID",
              value: String(response.profile.id),
              inline: true,
            },
          ];

          if (rolesAdded.length > 0) {
            logFields.push({
              name: "✅ Roles Added",
              value: rolesAdded.map((id) => `<@&${id}>`).join(", "),
              inline: false,
            });
          }

          if (rolesFailed.length > 0) {
            logFields.push({
              name: "❌ Roles Failed",
              value: rolesFailed.map((id) => `<@&${id}>`).join(", "),
              inline: false,
            });
          }

          await logGuildSuccess(
            guildId,
            client,

            "Auto-Verify: Success",
            `${member.user} verified as **${response.profile.name}** (${response.profile.id}).`,
            logFields,
          );
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

      const isNotLinked = /Incorrect ID/i.test(errorMessage);

      if (isNotLinked) {
        verificationResult = {
          status: "not_linked",
          title: "❌ Not Linked to Torn",
          description: "Your Discord account is not linked to a Torn account.",
          color: 0xef4444,
          errorMessage:
            "This Discord account is not linked to any Torn account",
        };
      } else {
        verificationResult = {
          status: "error",
          title: "❌ Verification Failed",
          description: `An unexpected error occurred. Please try the /verify command manually. (${errorMessage})`,
          color: 0xef4444,
          errorMessage,
        };
      }

      console.error(
        `[Auto-Verify] Error verifying ${member.user.username} (${member.id}):`,
        error,
      );

      if (!isNotLinked) {
        await logGuildError(
          guildId,
          client,

          "Auto-Verify: Unexpected Error",
          error instanceof Error ? error : String(error),
          `Unexpected error verifying ${member.user}.`,
        );
      }
    }

    // Send DM with verification results
    if (verificationResult) {
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor(verificationResult.color)
          .setTitle(verificationResult.title)
          .setDescription(verificationResult.description);

        if (verificationResult.data) {
          dmEmbed.addFields([
            {
              name: "Player Name",
              value: verificationResult.data.name,
              inline: true,
            },
            {
              name: "Player ID",
              value: String(verificationResult.data.id),
              inline: true,
            },
          ]);
          if (verificationResult.data.faction) {
            dmEmbed.addFields([
              {
                name: "Faction",
                value: `${verificationResult.data.faction.name} [${verificationResult.data.faction.tag}]`,
              },
            ]);
          }
        }

        await member.send({ embeds: [dmEmbed] });
      } catch (dmError) {
        console.warn(
          `[Auto-Verify] Failed to send verification DM to ${member.user.username}:`,
          dmError,
        );
        // Don't fail the entire verification process if DM fails
      }
    }
  } catch (error) {
    console.error("[Auto-Verify] Unexpected error:", error);
  }
});

await client.login(discordToken);
