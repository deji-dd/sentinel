import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type ChannelSelectMenuInteraction,
} from "discord.js";
import { randomUUID } from "crypto";
import { TABLE_NAMES, decryptApiKey } from "@sentinel/shared";
import { logGuildError, logGuildSuccess } from "../../../lib/guild-logger.js";

import * as reviveHandlers from "./handlers/revive.js";
import * as assistHandlers from "./handlers/assist.js";
import * as verifyHandlers from "./handlers/verify.js";
import * as territoriesHandlers from "./handlers/territories.js";
import * as mercenaryHandlers from "./handlers/mercenary.js";
import * as bazaarMugHandlers from "./handlers/bazaar-mug.js";
import * as reactionRolesHandlers from "./handlers/reaction-roles.js";
import { db } from "../../../lib/db-client.js";
import { getApiUrl } from "../../../lib/bot-config.js";
import { getGuildApiKeys } from "../../../lib/guild-api-keys.js";

const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;

type ConfigComponentRow = ActionRowBuilder<
  StringSelectMenuBuilder | ButtonBuilder
>;

if (!botOwnerId) {
  throw new Error("Missing SENTINEL_DISCORD_USER_ID environment variable");
}

function getDashboardTargetPath(isAdminGuild: boolean): "/admin" | "/config" {
  return isAdminGuild ? "/admin" : "/config";
}

/**
 * Check if user has permission to configure the guild
 */
export async function checkConfigPermissions(
  userId: string,
  guildId: string,
  userRoles: any,
): Promise<{ allowed: boolean; reason?: string }> {
  const userIsBotOwner = userId === botOwnerId;
  if (userIsBotOwner) {
    return { allowed: true };
  }

  const guildConfig = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .selectAll()
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  if (!guildConfig) {
    return {
      allowed: false,
      reason:
        "This server is not yet initialized in Sentinel. Please contact a server administrator or the bot owner.",
    };
  }

  const adminRoleIds: string[] =
    typeof guildConfig.admin_role_ids === "string"
      ? JSON.parse(guildConfig.admin_role_ids)
      : guildConfig.admin_role_ids || [];

  if (adminRoleIds.length > 0) {
    const hasAdminRole =
      userRoles &&
      "cache" in userRoles &&
      userRoles.cache.some((role: any) => adminRoleIds.includes(role.id));

    if (!hasAdminRole) {
      return {
        allowed: false,
        reason:
          "You do not have permission to manage this configuration. Only users with configured admin roles are authorized.",
      };
    }
  }

  return { allowed: true };
}

function getSessionUserId(footerText?: string, defaultUserId?: string): string {
  if (!footerText) return defaultUserId || "";
  const match = footerText.match(
    /Config Session:\s*(?:@?[^\s(]+\s*\()?(\d+)\)?/,
  );
  return match ? match[1] : defaultUserId || "";
}

function attachConfigTimeoutCollector(message: any): void {
  if (
    !message ||
    typeof message.createMessageComponentCollector !== "function"
  ) {
    return;
  }

  const collector = message.createMessageComponentCollector({
    idle: 900000, // 15 minutes
  });

  collector.on("collect", () => {
    // Idle timer is reset automatically by the collector
  });

  collector.on("end", async () => {
    try {
      const msg = await message.fetch().catch(() => null);
      if (!msg) return;

      const allDisabled = msg.components.every((row: any) =>
        row.components.every((c: any) => c.disabled),
      );
      if (allDisabled) return;

      const disabledRows = msg.components.map((row: any) => {
        const newRow = ActionRowBuilder.from(row as any);
        newRow.components.forEach((component: any) => {
          component.setDisabled(true);
        });
        return newRow;
      });

      const originalEmbed = msg.embeds[0];
      if (!originalEmbed) return;

      const timeoutEmbed = EmbedBuilder.from(originalEmbed);
      const currentDesc = originalEmbed.description || "";
      timeoutEmbed.setDescription(
        currentDesc +
          "\n\n*This configuration session has timed out due to inactivity and can no longer be edited.*",
      );

      await msg
        .edit({
          embeds: [timeoutEmbed],
          components: disabledRows as any[],
        })
        .catch(() => {});
    } catch (error) {
      console.error("Error in config timeout collector:", error);
    }
  });
}

/**
 * Helper to validate the configuration interaction.
 * Checks that the user is the original command runner and has valid permissions.
 */
export async function validateConfigInteraction(
  interaction:
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ChannelSelectMenuInteraction
    | RoleSelectMenuInteraction
    | ModalSubmitInteraction,
): Promise<boolean> {
  const guildId = interaction.guildId;
  if (!guildId) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Error")
      .setDescription("This command can only be used in a server.");
    const reply = await interaction.reply({
      embeds: [errorEmbed],
      fetchReply: true,
    });
    setTimeout(() => reply.delete().catch(() => {}), 8000);
    return false;
  }

  // Extract original user ID from embed footer
  const message = interaction.message;
  const footerText = message?.embeds?.[0]?.footer?.text;
  const originalUserId = getSessionUserId(footerText);

  if (originalUserId) {
    if (interaction.user.id !== originalUserId) {
      const warnEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Access Denied")
        .setDescription(
          `Only <@${originalUserId}> can interact with this configuration session. Please run the \`/config\` command to start your own session.`,
        )
        .setFooter({ text: "Sentinel" })
        .setTimestamp();
      const reply = await interaction.reply({
        embeds: [warnEmbed],
        fetchReply: true,
      });
      setTimeout(() => reply.delete().catch(() => {}), 8000);
      return false;
    }
  }

  // Verify permission
  const checkResult = await checkConfigPermissions(
    interaction.user.id,
    guildId,
    interaction.member?.roles,
  );

  if (!checkResult.allowed) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Permission Denied")
      .setDescription(
        checkResult.reason ||
          "You do not have permission to manage this configuration.",
      )
      .setFooter({ text: "Sentinel" })
      .setTimestamp();
    const reply = await interaction.reply({
      embeds: [errorEmbed],
      fetchReply: true,
    });
    setTimeout(() => reply.delete().catch(() => {}), 8000);
    return false;
  }

  return true;
}

function buildConfigViewMenuRow(
  enabledModules: string[] = [],
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const options: StringSelectMenuOptionBuilder[] = [];

  const moduleMetadata = [
    {
      id: "admin",
      label: "Admin Settings",
      description: "Manage API keys, logging, and admin roles",
    },
    {
      id: "verify",
      label: "Verification Settings",
      description: "Manage verification roles and nickname sync",
    },
    {
      id: "revive",
      label: "Revive Settings",
      description: "Manage revive request panel and hospital filters",
    },
    {
      id: "assist",
      label: "Assist Settings",
      description: "Manage combat assist routing and script configuration",
    },
    {
      id: "territories",
      label: "Territories Settings",
      description: "Manage territory assault checkers and map configurations",
    },
    {
      id: "mercenary",
      label: "Mercenary Settings",
      description: "Manage mercenary registrations, dibs, and payouts",
    },
    {
      id: "bazaar_mug",
      label: "Bazaar Mug Watcher Settings",
      description: "Manage bazaar mug targets watchlist and live dashboard",
    },
    {
      id: "reaction_roles",
      label: "Reaction Roles Settings",
      description: "Manage reaction role messages and mappings",
    },
  ];

  for (const module of moduleMetadata) {
    if (module.id === "admin" || enabledModules.includes(module.id)) {
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(module.label)
          .setValue(module.id)
          .setDescription(module.description),
      );
    }
  }

  if (options.length === 0) return null;

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("config_view_select")
    .setPlaceholder("Select a module")
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    selectMenu,
  );
}

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configure guild settings");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.deferReply();

    const guildId = interaction.guildId;
    const adminGuildId = process.env.ADMIN_GUILD_ID;
    const userIsBotOwner = interaction.user.id === botOwnerId;

    if (!guildId && !userIsBotOwner) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("This command can only be used in a guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    const isAdminGuild = guildId === adminGuildId || !guildId;
    const effectiveGuildId = guildId || adminGuildId || "DM";

    // Check if guild is configured
    let guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .selectAll()
      .where("guild_id", "=", effectiveGuildId)
      .executeTakeFirst();

    if (!guildConfig && isAdminGuild) {
      // Auto-initialize admin guild
      await db
        .insertInto(TABLE_NAMES.GUILD_CONFIG)
        .values({
          guild_id: effectiveGuildId,
          enabled_modules: JSON.stringify(["admin"]),
          admin_role_ids: JSON.stringify([]),
          verified_role_ids: JSON.stringify([]),
        })
        .execute();

      guildConfig = await db
        .selectFrom(TABLE_NAMES.GUILD_CONFIG)
        .selectAll()
        .where("guild_id", "=", effectiveGuildId)
        .executeTakeFirst();
    }

    if (!guildConfig) {
      if (userIsBotOwner) {
        const initEmbed = new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle("Guild Not Initialized")
          .setDescription(
            "This guild is not yet initialized in Sentinel's database. Since you are the bot owner, you can initialize it now.",
          )
          .setFooter({
            text: `Sentinel • Config Session: ${interaction.user.id}`,
          })
          .setTimestamp();

        const initBtn = new ButtonBuilder()
          .setCustomId("config_initialize_guild")
          .setLabel("Initialize Server Configuration")
          .setStyle(ButtonStyle.Primary);

        const initRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          initBtn,
        );

        const reply = await interaction.editReply({
          embeds: [initEmbed],
          components: [initRow],
        });
        attachConfigTimeoutCollector(reply);
        return;
      } else {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("Guild Not Initialized")
          .setDescription(
            "Please contact a server administrator or the bot owner to initialize this guild.",
          )
          .setFooter({ text: "Sentinel" })
          .setTimestamp();

        await interaction.editReply({
          embeds: [errorEmbed],
        });
        return;
      }
    }

    // Check if user has permission to use config command
    const permCheck = await checkConfigPermissions(
      interaction.user.id,
      effectiveGuildId,
      interaction.member?.roles,
    );

    if (!permCheck.allowed) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Not Authorized")
        .setDescription(
          permCheck.reason ||
            "You do not have permission to configure this server.",
        )
        .setFooter({ text: "Sentinel" })
        .setTimestamp();

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Show view selection menu
    const enabledModules: string[] =
      typeof guildConfig.enabled_modules === "string"
        ? JSON.parse(guildConfig.enabled_modules)
        : guildConfig.enabled_modules || [];
    const row = buildConfigViewMenuRow(enabledModules);

    const menuEmbed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Sentinel Guild Config")
      .setDescription("Manage your guild configuration.")
      .setFooter({
        text: `Sentinel • Config Session: ${interaction.user.id}`,
      })
      .setTimestamp();

    const components: ConfigComponentRow[] = [];
    if (row) {
      components.push(row as ConfigComponentRow);
    }

    const reply = await interaction.editReply({
      embeds: [menuEmbed],
      components,
    });
    attachConfigTimeoutCollector(reply);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in config command:", errorMsg);
    if (interaction.guildId) {
      await logGuildError(
        interaction.guildId,
        interaction.client,
        "Config Command Error",
        error instanceof Error ? error : errorMsg,
        `Error running config command for ${interaction.user}.`,
      );
    }
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Error")
      .setDescription(errorMsg);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        embeds: [errorEmbed],
      });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
      });
    }
  }
}

// Handler for view selection menu
export async function handleViewSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    const selectedView = interaction.values[0];

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Unable to determine guild.");

      await interaction.reply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Get guild config BEFORE deferring
    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!guildConfig) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Guild configuration not found.");

      await interaction.reply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // NOW defer after we have the data
    await interaction.deferUpdate();

    const enabledModules: string[] =
      typeof guildConfig.enabled_modules === "string"
        ? JSON.parse(guildConfig.enabled_modules)
        : guildConfig.enabled_modules || [];

    if (selectedView !== "admin" && !enabledModules.includes(selectedView)) {
      const disabledEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Module Not Enabled")
        .setDescription(
          `The **${selectedView.replace(/_/g, " ")}** module is not enabled for this guild.`,
        );

      await interaction.editReply({
        embeds: [disabledEmbed],
        components: [],
      });
      return;
    }

    if (selectedView !== "admin") {
      const keys = await getGuildApiKeys(guildId);
      if (keys.length === 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("API Key Required")
          .setDescription(
            `The **${selectedView.replace(/_/g, " ")}** module requires at least one Torn API key to be configured for this server. ` +
              `Please add a Torn API key under **Admin Settings** > **Manage API Keys** first.`,
          )
          .setFooter({ text: "Sentinel" })
          .setTimestamp();

        const backBtn = new ButtonBuilder()
          .setCustomId("config_back_to_menu")
          .setLabel("Back")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

        await interaction.editReply({
          embeds: [errorEmbed],
          components: [row],
        });
        return;
      }
    }

    if (selectedView === "revive") {
      await reviveHandlers.handleShowReviveSettings(interaction, true);
    } else if (selectedView === "assist") {
      await assistHandlers.handleShowAssistSettings(interaction, true);
    } else if (selectedView === "verify") {
      await verifyHandlers.handleShowVerifySettings(interaction, true);
    } else if (selectedView === "territories") {
      await territoriesHandlers.handleShowTerritoriesSettings(interaction, true);
    } else if (selectedView === "mercenary") {
      await mercenaryHandlers.handleShowMercenarySettings(interaction, true);
    } else if (selectedView === "bazaar_mug") {
      await bazaarMugHandlers.handleShowBazaarMugSettings(interaction, true);
    } else if (selectedView === "reaction_roles") {
      await reactionRolesHandlers.handleShowReactionRolesSettings(interaction, true);
    } else if (selectedView === "admin") {
      await handleShowAdminSettings(interaction, true);
    } else {
      const footerText = interaction.message.embeds[0]?.footer?.text;
      const originalUserId = getSessionUserId(footerText, interaction.user.id);
      await showScaffoldedModule(interaction, selectedView, originalUserId);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in view select handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
      components: [],
    });
  }
}

// Back button handler
export async function handleBackToMenu(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const adminGuildId = process.env.ADMIN_GUILD_ID;
    const isAdminGuild = guildId === adminGuildId;

    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .select(["enabled_modules"])
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    const enabledModules: string[] =
      typeof guildConfig?.enabled_modules === "string"
        ? JSON.parse(guildConfig.enabled_modules)
        : guildConfig?.enabled_modules || [];

    const row = buildConfigViewMenuRow(enabledModules);

    const components: ConfigComponentRow[] = [];
    if (row) {
      components.push(row as ConfigComponentRow);
    }

    const footerText = interaction.message.embeds[0]?.footer?.text;
    const originalUserId = getSessionUserId(footerText, interaction.user.id);

    const menuEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Guild Configuration")
      .setDescription("Select a module.")
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [menuEmbed],
      components,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in back to menu handler:", errorMsg);
  }
}

export async function handleEditLogChannelButton(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred) {
      await interaction.deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .select(["log_channel_id"])
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    const channelSelectMenu = new ChannelSelectMenuBuilder()
      .setCustomId("config_log_channel_select")
      .setPlaceholder("Select a channel for logging")
      .addChannelTypes(ChannelType.GuildText);

    const clearBtn = new ButtonBuilder()
      .setCustomId("config_clear_log_channel")
      .setLabel("Clear Log Channel")
      .setStyle(ButtonStyle.Danger);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_admin_settings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const menuRow =
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        channelSelectMenu,
      );
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      clearBtn,
      backBtn,
    );

    const footerText = interaction.message.embeds[0]?.footer?.text;
    const originalUserId = getSessionUserId(footerText, interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Log Channel Configuration")
      .setDescription(
        guildConfig?.log_channel_id
          ? `Currently set to <#${guildConfig.log_channel_id}>\n\nSelect a new channel or clear the current one.`
          : "No log channel set. Select a text channel to enable logging.",
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [menuRow, buttonRow],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in edit log channel button handler:", errorMsg);
  }
}

export async function handleLogChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const selectedChannel = interaction.channels.first();
    if (!selectedChannel || selectedChannel.type !== ChannelType.GuildText) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Invalid Channel")
        .setDescription("Please select a text channel.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Update guild config with log channel
    try {
      await db
        .updateTable(TABLE_NAMES.GUILD_CONFIG)
        .set({ log_channel_id: selectedChannel.id })
        .where("guild_id", "=", guildId)
        .execute();
    } catch (error) {
      await logGuildError(
        guildId,
        interaction.client,

        "Log Channel Update Failed",
        error instanceof Error ? error.message : String(error),
        `Failed to set log channel to ${selectedChannel}.`,
      );
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Failed to save log channel configuration.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    const footerText = interaction.message?.embeds?.[0]?.footer?.text;
    const originalUserId = getSessionUserId(footerText, interaction.user.id);

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Log Channel Updated")
      .setDescription(`Log channel set to ${selectedChannel}`)
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    // Log this action
    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "log_channel_updated",
      details: { log_channel_id: selectedChannel.id },
    });

    await logGuildSuccess(
      guildId,
      interaction.client,

      "Log Channel Updated",
      `${interaction.user} set the log channel to ${selectedChannel}.`,
      [{ name: "Channel", value: selectedChannel.toString(), inline: false }],
    );

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_admin_settings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in log channel select handler:", errorMsg);
  }
}

export async function handleClearLogChannel(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    // Clear log channel
    try {
      await db
        .updateTable(TABLE_NAMES.GUILD_CONFIG)
        .set({ log_channel_id: null })
        .where("guild_id", "=", guildId)
        .execute();
    } catch (error) {
      await logGuildError(
        guildId,
        interaction.client,

        "Log Channel Clear Failed",
        error instanceof Error ? error.message : String(error),
        `Failed to clear log channel for ${interaction.user}.`,
      );
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Failed to clear log channel.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    const footerText = interaction.message?.embeds?.[0]?.footer?.text;
    const originalUserId = getSessionUserId(footerText, interaction.user.id);

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Log Channel Cleared")
      .setDescription("Logging has been disabled.")
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    // Log this action
    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "log_channel_cleared",
    });

    await logGuildSuccess(
      guildId,
      interaction.client,

      "Log Channel Cleared",
      `${interaction.user} disabled guild logging.`,
    );

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_admin_settings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in clear log channel handler:", errorMsg);
  }
}

// Handler for edit admin roles button
export async function handleEditAdminRolesButton(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred) {
      await interaction.deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .select(["admin_role_ids"])
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    const adminRoleIds: string[] = guildConfig?.admin_role_ids
      ? JSON.parse(guildConfig.admin_role_ids)
      : [];

    let rolesDisplay = "Anyone can use /config (no restricted roles)";
    if (adminRoleIds.length > 0) {
      rolesDisplay = adminRoleIds.map((roleId) => `<@&${roleId}>`).join(", ");
    }

    const roleSelectMenu = new RoleSelectMenuBuilder()
      .setCustomId("config_admin_roles_select")
      .setPlaceholder("Select admin roles...")
      .setMinValues(0)
      .setMaxValues(25);

    if (adminRoleIds.length > 0) {
      roleSelectMenu.setDefaultRoles(...adminRoleIds);
    }

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_admin_settings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const menuRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      roleSelectMenu,
    );
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      backBtn,
    );

    const footerText = interaction.message.embeds[0]?.footer?.text;
    const originalUserId = getSessionUserId(footerText, interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Manage Admin Roles")
      .setDescription(
        "Select roles that are allowed to use the /config command. If no roles are selected, anyone can use /config.",
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [menuRow, buttonRow],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in edit admin roles handler:", errorMsg);
  }
}

// Handler for admin roles select
export async function handleAdminRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const selectedRoleIds = interaction.values;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Unable to determine guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Update guild config with selected admin roles
    try {
      await db
        .updateTable(TABLE_NAMES.GUILD_CONFIG)
        .set({
          admin_role_ids: JSON.stringify(selectedRoleIds),
        })
        .where("guild_id", "=", guildId)
        .execute();
    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Update Admin Roles")
        .setDescription(error instanceof Error ? error.message : String(error))
        .setFooter({ text: "Sentinel" })
        .setTimestamp();

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Log this action
    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "admin_roles_updated",
      details: {
        role_ids: selectedRoleIds,
        role_count: selectedRoleIds.length,
      },
    });

    // Show success message
    let rolesDisplay = "Anyone can use /config";
    if (selectedRoleIds.length > 0) {
      rolesDisplay = selectedRoleIds
        .map((roleId) => `<@&${roleId}>`)
        .join(", ");
    }

    const footerText = interaction.message?.embeds?.[0]?.footer?.text;
    const originalUserId = getSessionUserId(footerText, interaction.user.id);

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Admin Roles Updated")
      .setDescription(`Allowed roles:\n${rolesDisplay}`)
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_admin_settings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });

    await logGuildSuccess(
      guildId,
      interaction.client,

      "Admin Roles Updated",
      `${interaction.user} updated admin roles. Count: ${selectedRoleIds.length}`,
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in admin roles select handler:", errorMsg);
  }
}

async function logGuildAudit(entry: {
  guildId: string;
  actorId: string;
  action: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db
      .insertInto(TABLE_NAMES.GUILD_AUDIT)
      .values({
        id: randomUUID(),
        guild_id: entry.guildId,
        actor_discord_id: entry.actorId,
        action: entry.action,
        details: entry.details ? JSON.stringify(entry.details) : null,
      })
      .execute();
  } catch (error) {
    console.warn("Failed to write guild audit entry:", error);
  }
}

export async function handleShowReviveSettings(
  interaction: reviveHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return reviveHandlers.handleShowReviveSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleReviveSettingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveSettingSelect(interaction);
}

export async function handleShowMinHospSettings(
  interaction: reviveHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return reviveHandlers.handleShowMinHospSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleReviveSetMinHospButton(
  interaction: ButtonInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveSetMinHospButton(interaction);
}

export async function handleReviveSetMinHospModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveSetMinHospModal(interaction);
}

export async function handleReviveRequestChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveRequestChannelSelect(interaction);
}

export async function handleReviveOutputChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveOutputChannelSelect(interaction);
}

export async function handleRevivePingRoleSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  return reviveHandlers.handleRevivePingRoleSelect(interaction);
}

export async function handleReviveRequestMe(
  interaction: ButtonInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveRequestMe(interaction);
}

export async function handleReviveRequestOther(
  interaction: ButtonInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveRequestOther(interaction);
}

export async function handleReviveRequestOtherModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveRequestOtherModal(interaction);
}

export async function handleReviveConfirmRequest(
  interaction: ButtonInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveConfirmRequest(interaction);
}

export async function handleReviveCancelRequest(
  interaction: ButtonInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveCancelRequest(interaction);
}

export async function handleReviveMarkRevived(
  interaction: ButtonInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveMarkRevived(interaction);
}

export async function handleShowAssistSettings(
  interaction: assistHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return assistHandlers.handleShowAssistSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleAssistSettingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return assistHandlers.handleAssistSettingSelect(interaction);
}

export async function handleAssistChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return assistHandlers.handleAssistChannelSelect(interaction);
}

export async function handleAssistPingRoleSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  return assistHandlers.handleAssistPingRoleSelect(interaction);
}

export async function handleAssistScriptRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  return assistHandlers.handleAssistScriptRolesSelect(interaction);
}

export async function handleAssistManageUsers(
  interaction: assistHandlers.ConfigInteraction,
): Promise<void> {
  return assistHandlers.handleAssistManageUsers(interaction);
}

export async function handleAssistManagePageButton(
  interaction: ButtonInteraction,
): Promise<void> {
  return assistHandlers.handleAssistManagePageButton(interaction);
}

export async function handleAssistManageUserSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return assistHandlers.handleAssistManageUserSelect(interaction);
}

export async function handleAssistManageActionSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return assistHandlers.handleAssistManageActionSelect(interaction);
}

export async function handleAssistManageBackButton(
  interaction: ButtonInteraction,
): Promise<void> {
  return assistHandlers.handleAssistManageBackButton(interaction);
}

export async function handleShowTerritoriesSettings(
  interaction: territoriesHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return territoriesHandlers.handleShowTerritoriesSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleTerritoriesSettingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return territoriesHandlers.handleTerritoriesSettingSelect(interaction);
}

export async function handleTerritoriesSetFullChannel(
  interaction: territoriesHandlers.ConfigInteraction,
): Promise<void> {
  return territoriesHandlers.handleTerritoriesSetFullChannel(interaction);
}

export async function handleTerritoriesSetFilteredChannel(
  interaction: territoriesHandlers.ConfigInteraction,
): Promise<void> {
  return territoriesHandlers.handleTerritoriesSetFilteredChannel(interaction);
}

export async function handleTerritoriesFullChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return territoriesHandlers.handleTerritoriesFullChannelSelect(interaction);
}

export async function handleTerritoriesFilteredChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return territoriesHandlers.handleTerritoriesFilteredChannelSelect(interaction);
}

export async function handleShowWatchedTerritoriesSettings(
  interaction: territoriesHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return territoriesHandlers.handleShowWatchedTerritoriesSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleTerritoriesSetWatchedTerritoriesBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return territoriesHandlers.handleTerritoriesSetWatchedTerritoriesBtn(interaction);
}

export async function handleTerritoriesWatchedTerritoriesModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return territoriesHandlers.handleTerritoriesWatchedTerritoriesModal(interaction);
}

export async function handleShowWatchedFactionsSettings(
  interaction: territoriesHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return territoriesHandlers.handleShowWatchedFactionsSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleTerritoriesSetWatchedFactionsBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return territoriesHandlers.handleTerritoriesSetWatchedFactionsBtn(interaction);
}

export async function handleTerritoriesWatchedFactionsModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return territoriesHandlers.handleTerritoriesWatchedFactionsModal(interaction);
}

export async function handleShowMercenarySettings(
  interaction: mercenaryHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return mercenaryHandlers.handleShowMercenarySettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleMercenarySettingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenarySettingSelect(interaction);
}

export async function handleMercenaryAnnouncementChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryAnnouncementChannelSelect(interaction);
}

export async function handleMercenaryClearAnnouncementChannelBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryClearAnnouncementChannelBtn(interaction);
}

export async function handleMercenaryPayoutChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryPayoutChannelSelect(interaction);
}

export async function handleMercenaryClearPayoutChannelBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryClearPayoutChannelBtn(interaction);
}

export async function handleMercenaryRegistrationChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryRegistrationChannelSelect(interaction);
}

export async function handleMercenaryClearRegistrationChannelBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryClearRegistrationChannelBtn(interaction);
}

export async function handleMercenaryHitPostChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryHitPostChannelSelect(interaction);
}

export async function handleMercenaryClearHitPostChannelBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryClearHitPostChannelBtn(interaction);
}

export async function handleMercenaryAuditChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryAuditChannelSelect(interaction);
}

export async function handleMercenaryClearAuditChannelBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryClearAuditChannelBtn(interaction);
}

export async function handleShowMercenaryRolesSettings(
  interaction: mercenaryHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return mercenaryHandlers.handleShowMercenaryRolesSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleMercenaryRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryRolesSelect(interaction);
}

export async function handleShowDibsSettings(
  interaction: mercenaryHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return mercenaryHandlers.handleShowDibsSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleMercenaryToggleDibsBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryToggleDibsBtn(interaction);
}

export async function handleMercenarySetMaxDibsBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenarySetMaxDibsBtn(interaction);
}

export async function handleMercenaryMaxDibsModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryMaxDibsModal(interaction);
}

export async function handleMercenarySetDibsTimeBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenarySetDibsTimeBtn(interaction);
}

export async function handleMercenaryDibsTimeModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryDibsTimeModal(interaction);
}

export async function handleShowContractSettings(
  interaction: mercenaryHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return mercenaryHandlers.handleShowContractSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleMercenaryCloseContractSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryCloseContractSelect(interaction);
}

export async function handleMercenaryCreateContractBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryCreateContractBtn(interaction);
}

export async function handleMercenaryCreateContractModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return mercenaryHandlers.handleMercenaryCreateContractModal(interaction);
}

export async function handleShowBazaarMugSettings(
  interaction: bazaarMugHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return bazaarMugHandlers.handleShowBazaarMugSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleBazaarMugSettingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugSettingSelect(interaction);
}

export async function handleBazaarMugToggle(
  interaction: bazaarMugHandlers.ConfigInteraction,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugToggle(interaction);
}

export async function handleBazaarMugSetChannel(
  interaction: bazaarMugHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugSetChannel(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleBazaarMugChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugChannelSelect(interaction);
}

export async function handleBazaarMugClearChannelBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugClearChannelBtn(interaction);
}

export async function handleShowBazaarMugRoleSettings(
  interaction: bazaarMugHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  return bazaarMugHandlers.handleShowBazaarMugRoleSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleBazaarMugRoleSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugRoleSelect(interaction);
}

export async function handleBazaarMugClearRoleBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugClearRoleBtn(interaction);
}

export async function handleShowBazaarMugThresholdSettings(
  interaction: bazaarMugHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  return bazaarMugHandlers.handleShowBazaarMugThresholdSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleBazaarMugSetThresholdBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugSetThresholdBtn(interaction);
}

export async function handleBazaarMugThresholdModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugThresholdModal(interaction);
}

export async function handleShowBazaarMugMinOfflineSettings(
  interaction: bazaarMugHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return bazaarMugHandlers.handleShowBazaarMugMinOfflineSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleBazaarMugSetMinOfflineBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugSetMinOfflineBtn(interaction);
}

export async function handleBazaarMugMinOfflineModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugMinOfflineModal(interaction);
}


export async function handleShowBazaarMugWatchlistSettings(
  interaction: bazaarMugHandlers.ConfigInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return bazaarMugHandlers.handleShowBazaarMugWatchlistSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleBazaarMugEditWatchlistBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugEditWatchlistBtn(interaction);
}

export async function handleBazaarMugWatchlistModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return bazaarMugHandlers.handleBazaarMugWatchlistModal(interaction);
}

export async function handleShowAdminSettings(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;

  if (!isAlreadyDeferred) {
    await interaction.deferUpdate();
  }

  const footerText = interaction.message?.embeds?.[0]?.footer?.text;
  const originalUserId = getSessionUserId(footerText, interaction.user.id);

  const adminEmbed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("Admin Settings")
    .setDescription(
      "Select a setting below to configure guild administration settings.",
    )
    .setFooter({
      text: `Sentinel • Config Session: ${originalUserId}`,
    })
    .setTimestamp();

  const settingSelect = new StringSelectMenuBuilder()
    .setCustomId("config_admin_setting_select")
    .setPlaceholder("Select a setting to edit...")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Manage API Keys")
        .setValue("keys")
        .setDescription("Add, remove, and view Torn API keys"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Configure Log Channel")
        .setValue("log_channel")
        .setDescription("Set or clear the text channel for bot logs"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Manage Admin Roles")
        .setValue("admin_roles")
        .setDescription("Select roles allowed to execute config commands"),
    );

  const backBtn = new ButtonBuilder()
    .setCustomId("config_back_to_menu")
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const selectRow =
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      settingSelect,
    );
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    backBtn,
  );

  await interaction.editReply({
    embeds: [adminEmbed],
    components: [selectRow, buttonRow],
  });
}

export async function handleAdminSettingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const selectedSetting = interaction.values[0];

    if (selectedSetting === "keys") {
      await handleShowApiKeys(interaction, true);
    } else if (selectedSetting === "log_channel") {
      await handleEditLogChannelButton(interaction, true);
    } else if (selectedSetting === "admin_roles") {
      await handleEditAdminRolesButton(interaction, true);
    }
  } catch (error) {
    console.error("Error in admin setting select handler:", error);
  }
}

export async function handleShowApiKeys(
  interaction:
    | StringSelectMenuInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred) {
      await interaction.deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    // Fetch keys for this guild
    const keysData = await db
      .selectFrom(TABLE_NAMES.GUILD_API_KEYS)
      .select(["id", "api_key_encrypted", "provided_by", "is_primary"])
      .where("guild_id", "=", guildId)
      .where("deleted_at", "is", null)
      .execute();

    const footerText = interaction.message?.embeds?.[0]?.footer?.text;
    const originalUserId = getSessionUserId(footerText, interaction.user.id);

    let apiKeyDisplay = "No API keys configured for this server.";
    if (keysData.length > 0) {
      apiKeyDisplay = keysData
        .map((row) => {
          let keyDecrypted = "";
          try {
            keyDecrypted = decryptApiKey(
              row.api_key_encrypted,
              process.env.ENCRYPTION_KEY!,
            );
          } catch {
            keyDecrypted = "invalid";
          }
          const censored =
            keyDecrypted.length >= 4
              ? `•••• •••• •••• ${keyDecrypted.slice(-4)}`
              : "•••• •••• •••• ••••";
          const primaryBadge = row.is_primary ? " (Primary)" : "";
          const addedBy = row.provided_by ? `<@${row.provided_by}>` : "System";
          return `• ${censored}${primaryBadge} • Added by ${addedBy}`;
        })
        .join("\n");
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("API Key Configuration")
      .setDescription(
        "Add or remove API keys used for guild operations.\n\n" +
          "**Active Keys:**\n" +
          apiKeyDisplay,
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const components: any[] = [];

    // If keys exist, add a select menu to remove a key
    if (keysData.length > 0) {
      const removeSelect = new StringSelectMenuBuilder()
        .setCustomId("config_remove_api_key_select")
        .setPlaceholder("Select a key to remove...");

      const options = keysData.map((row) => {
        let keyDecrypted = "";
        try {
          keyDecrypted = decryptApiKey(
            row.api_key_encrypted,
            process.env.ENCRYPTION_KEY!,
          );
        } catch {
          keyDecrypted = "invalid";
        }
        const censored =
          keyDecrypted.length >= 4
            ? `•••• •••• •••• ${keyDecrypted.slice(-4)}`
            : "•••• •••• •••• ••••";

        return new StringSelectMenuOptionBuilder()
          .setLabel(censored + (row.is_primary ? " (Primary)" : ""))
          .setValue(row.id);
      });

      removeSelect.addOptions(options);
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          removeSelect,
        ),
      );
    }

    const addBtn = new ButtonBuilder()
      .setCustomId("config_add_api_key")
      .setLabel("Add API Key")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_admin_settings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(addBtn, backBtn),
    );

    await interaction.editReply({
      embeds: [embed],
      components,
    });
  } catch (error) {
    console.error("Error showing API keys:", error);
  }
}

export async function handleConfigAddApiKeyButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const modal = new ModalBuilder()
      .setCustomId("config_add_api_key_modal")
      .setTitle("Add API Key");

    const keyInput = new TextInputBuilder()
      .setCustomId("config_add_api_key_input")
      .setLabel("Torn API Key")
      .setStyle(TextInputStyle.Short)
      .setMinLength(16)
      .setMaxLength(16)
      .setRequired(true)
      .setPlaceholder("Enter 16-character Torn API key");

    const primaryInput = new TextInputBuilder()
      .setCustomId("config_add_api_key_primary")
      .setLabel("Set as Primary Key? (yes/no)")
      .setStyle(TextInputStyle.Short)
      .setMinLength(2)
      .setMaxLength(3)
      .setRequired(false)
      .setPlaceholder("no");

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(
      keyInput,
    );
    const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(
      primaryInput,
    );

    modal.addComponents(row1, row2);

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error showing add API key modal:", error);
  }
}

export async function handleConfigAddApiKeyModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const apiKey = interaction.fields
      .getTextInputValue("config_add_api_key_input")
      .trim();
    const primaryText = interaction.fields
      .getTextInputValue("config_add_api_key_primary")
      ?.trim()
      .toLowerCase();
    const isPrimary = primaryText === "yes" || primaryText === "y";

    // Validate API key format
    if (!/^[a-zA-Z0-9]{16}$/.test(apiKey)) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Invalid API Key")
        .setDescription("API Key must be exactly 16 alphanumeric characters.")
        .setFooter({ text: "Sentinel" })
        .setTimestamp();

      const reply = await interaction.followUp({
        embeds: [errorEmbed],
        fetchReply: true,
      });
      setTimeout(() => reply.delete().catch(() => {}), 8000);
      return;
    }

    // Validate key with Torn API
    let keyInfo;
    try {
      const { validateTornApiKey } =
        await import("../../../services/torn-client.js");
      keyInfo = await validateTornApiKey(apiKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("API Key Validation Failed")
        .setDescription(msg)
        .setFooter({ text: "Sentinel" })
        .setTimestamp();

      const reply = await interaction.followUp({
        embeds: [errorEmbed],
        fetchReply: true,
      });
      setTimeout(() => reply.delete().catch(() => {}), 8000);
      return;
    }

    // Save key in database
    const { storeGuildApiKey } = await import("../../../lib/guild-api-keys.js");
    await storeGuildApiKey(
      guildId,
      apiKey,
      keyInfo.playerId,
      interaction.user.id,
      isPrimary,
    );

    // Sync cron schedules
    const { syncAutoVerifyCronSchedule, syncWarTrackerCronSchedules } =
      await import("../../../lib/cron-schedule-registry.js");
    await syncAutoVerifyCronSchedule(guildId, interaction.client);
    await syncWarTrackerCronSchedules();

    // Log the addition (mask the key)
    const maskedKey = `•••• •••• •••• ${apiKey.slice(-4)}`;
    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "api_key_added",
      details: {
        player_id: keyInfo.playerId,
        is_primary: isPrimary,
      },
    });

    await logGuildSuccess(
      guildId,
      interaction.client,
      "API Key Added",
      `${interaction.user} added a new API key (${maskedKey}).`,
      [
        { name: "Player ID", value: String(keyInfo.playerId), inline: true },
        { name: "Primary Key", value: isPrimary ? "Yes" : "No", inline: true },
      ],
    );

    // Refresh view
    await handleShowApiKeys(interaction, true);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in add API key modal handler:", errorMsg);
  }
}

export async function handleConfigRemoveApiKeySelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const selectedId = interaction.values[0];

    // Find key in database first
    const keyRow = await db
      .selectFrom(TABLE_NAMES.GUILD_API_KEYS)
      .selectAll()
      .where("id", "=", selectedId)
      .where("guild_id", "=", guildId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();

    if (!keyRow) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription(
          "The selected API key was not found or has already been deleted.",
        )
        .setFooter({ text: "Sentinel" })
        .setTimestamp();

      const reply = await interaction.followUp({
        embeds: [errorEmbed],
        fetchReply: true,
      });
      setTimeout(() => reply.delete().catch(() => {}), 8000);
      return;
    }

    const { deleteGuildApiKey } =
      await import("../../../lib/guild-api-keys.js");
    let decryptedKey = "";
    try {
      decryptedKey = decryptApiKey(
        keyRow.api_key_encrypted,
        process.env.ENCRYPTION_KEY!,
      );
    } catch {
      // If decryption fails, soft-delete directly in DB
      const now = new Date().toISOString();
      await db
        .updateTable(TABLE_NAMES.GUILD_API_KEYS)
        .set({ deleted_at: now })
        .where("id", "=", selectedId)
        .execute();
    }

    if (decryptedKey) {
      await deleteGuildApiKey(guildId, decryptedKey);
    }

    // Sync cron schedules
    const { syncAutoVerifyCronSchedule, syncWarTrackerCronSchedules } =
      await import("../../../lib/cron-schedule-registry.js");
    await syncAutoVerifyCronSchedule(guildId, interaction.client);
    await syncWarTrackerCronSchedules();

    // Log the removal
    const maskedKey = decryptedKey
      ? `•••• •••• •••• ${decryptedKey.slice(-4)}`
      : "Unknown Key";
    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "api_key_removed",
      details: {
        player_id: keyRow.user_id,
        is_primary: keyRow.is_primary,
      },
    });

    await logGuildSuccess(
      guildId,
      interaction.client,
      "API Key Removed",
      `${interaction.user} removed an API key (${maskedKey}).`,
      [
        { name: "Player ID", value: String(keyRow.user_id), inline: true },
        {
          name: "Primary Key",
          value: keyRow.is_primary ? "Yes" : "No",
          inline: true,
        },
      ],
    );

    // Refresh view
    await handleShowApiKeys(interaction, true);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in remove API key select handler:", errorMsg);
  }
}

export async function showScaffoldedModule(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  moduleName: string,
  originalUserId: string,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const moduleData: Record<
    string,
    {
      title: string;
      desc: string;
      buttons: { id: string; label: string; style: ButtonStyle }[];
    }
  > = {
    verify: {
      title: "Verification Settings",
      desc: "Manage auto-verification for new members, link Discord accounts to Torn profiles, assign verified roles, and sync nicknames automatically.",
      buttons: [
        {
          id: "config_scaffold_verify_toggle",
          label: "Toggle Auto-Verify",
          style: ButtonStyle.Primary,
        },
        {
          id: "config_scaffold_verify_role",
          label: "Set Verified Role",
          style: ButtonStyle.Primary,
        },
        {
          id: "config_scaffold_verify_sync",
          label: "Sync Nicknames",
          style: ButtonStyle.Secondary,
        },
      ],
    },
  };

  const currentModule = moduleData[moduleName];
  if (!currentModule) return;

  const footerText = interaction.message.embeds[0]?.footer?.text;
  const match = footerText?.match(/Config Session:\s*@?([^\s(]+)\s*\((\d+)\)/);
  const originalUserTag = match ? match[1] : interaction.user.username;

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle(`Sentinel • ${currentModule.title}`)
    .setDescription(currentModule.desc)
    .addFields({
      name: "Dashboard Controls",
      value:
        "This module is configured using interactive controls. Click any action below to test the GUI flow, or access the Web Dashboard for full options.",
    })
    .setFooter({
      text: `Sentinel • Config Session: @${originalUserTag} (${originalUserId})`,
    })
    .setTimestamp();

  const webDashboardRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("config_back_to_menu")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary),
  );

  const actionRow = new ActionRowBuilder<ButtonBuilder>();
  for (const btn of currentModule.buttons) {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(btn.id)
        .setLabel(btn.label)
        .setStyle(btn.style),
    );
  }

  await interaction.editReply({
    embeds: [embed],
    components: [actionRow, webDashboardRow],
  });
}

export async function handleInitializeGuild(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    await interaction.deferUpdate();

    let guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!guildConfig) {
      await db
        .insertInto(TABLE_NAMES.GUILD_CONFIG)
        .values({
          guild_id: guildId,
          enabled_modules: JSON.stringify(["admin"]),
          admin_role_ids: JSON.stringify([]),
          verified_role_ids: JSON.stringify([]),
        })
        .execute();

      try {
        await db
          .insertInto(TABLE_NAMES.GUILD_SYNC_JOBS)
          .values({
            guild_id: guildId,
            next_sync_at: new Date().toISOString(),
          })
          .execute();
      } catch {
        // Ignore sync job creation failures
      }

      const { deployGuildCommands } =
        await import("../../../lib/deploy-commands-helper.js");
      await deployGuildCommands(guildId);

      await logGuildSuccess(
        guildId,
        interaction.client,
        "Guild Config Initialized",
        `Guild configuration initialized by bot owner ${interaction.user}.`,
      );
    }

    await handleBackToMenu(interaction);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in guild initialization handler:", errorMsg);
  }
}

export async function handleScaffoldButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const infoEmbed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("Migration in Progress")
    .setDescription(
      "This module is currently being migrated to Discord. Please configure these settings in the Web Dashboard for now.",
    )
    .setFooter({ text: "Sentinel" })
    .setTimestamp();

  const reply = await interaction.reply({
    embeds: [infoEmbed],
    fetchReply: true,
  });
  setTimeout(() => reply.delete().catch(() => {}), 6000);
}

export async function handleShowReactionRolesSettings(
  interaction: reactionRolesHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  return reactionRolesHandlers.handleShowReactionRolesSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleReactionRolesSettingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleReactionRolesSettingSelect(interaction);
}

export async function handleReactionRolesAddMessage(
  interaction: reactionRolesHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  return reactionRolesHandlers.handleReactionRolesAddMessage(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleReactionRolesChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleReactionRolesChannelSelect(interaction);
}

export async function handleReactionRolesRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleReactionRolesRolesSelect(interaction);
}

export async function handleReactionRolesFillDetails(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleReactionRolesFillDetails(interaction);
}

export async function handleReactionRolesModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleReactionRolesModalSubmit(interaction);
}

export async function handleShowManageExistingMessages(
  interaction: reactionRolesHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  return reactionRolesHandlers.handleShowManageExistingMessages(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleReactionRolesSelectMessage(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleReactionRolesSelectMessage(interaction);
}

export async function handleReactionRoleDeleteMsgBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleReactionRoleDeleteMsgBtn(interaction);
}

export async function handleReactionRolesRequiredRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleReactionRolesRequiredRolesSelect(interaction);
}

export async function handleReactionRolesSkipRequiredRoles(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleReactionRolesSkipRequiredRoles(interaction);
}

export async function handleReactionRolesBackToRequiredRoles(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleReactionRolesBackToRequiredRoles(interaction);
}

export async function handleReactionRolesBackToMappedRoles(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleReactionRolesBackToMappedRoles(interaction);
}
