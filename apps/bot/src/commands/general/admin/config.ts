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
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type ChannelSelectMenuInteraction,
} from "discord.js";
import { randomUUID } from "crypto";
import { TABLE_NAMES } from "@sentinel/shared";
import { logGuildError, logGuildSuccess } from "../../../lib/guild-logger.js";

import * as reviveHandlers from "./handlers/revive.js";
import * as assistHandlers from "./handlers/assist.js";
import { db } from "../../../lib/db-client.js";
import { MagicLinkService } from "../../../services/magic-link-service.js";
import { getApiUrl } from "../../../lib/bot-config.js";

const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;

if (!botOwnerId) {
  throw new Error("Missing SENTINEL_DISCORD_USER_ID environment variable");
}

function buildConfigViewMenuRow(
  enabledModules: string[] = [],
): ActionRowBuilder<StringSelectMenuBuilder> {
  const options: StringSelectMenuOptionBuilder[] = [];



  if (enabledModules.includes("revive")) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel("Revive Settings")
        .setValue("revive")
        .setDescription("Revive request panel and request filters"),
    );
  }

  if (enabledModules.includes("assist")) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel("Assist Settings")
        .setValue("assist")
        .setDescription("Configure combat assist alert routing"),
    );
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("config_view_select")
    .setPlaceholder("Select a settings section...")
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guildId;
    const adminGuildId = process.env.ADMIN_GUILD_ID;
    const isAdminGuild = guildId === adminGuildId;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("This command can only be used in a guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Check if guild is configured
    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!guildConfig) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Guild Not Initialized")
        .setDescription(
          "Please contact the bot owner to initialize this guild.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Check if user has permission to use config command
    const adminRoleIds: string[] =
      typeof guildConfig.admin_role_ids === "string"
        ? JSON.parse(guildConfig.admin_role_ids)
        : guildConfig.admin_role_ids || [];

    const userIsBotOwner = interaction.user.id === botOwnerId;

    if (!userIsBotOwner && adminRoleIds.length > 0) {
      // Admin roles are set, check if user has one of them
      const userRoles = interaction.member?.roles;
      const hasAdminRole =
        userRoles &&
        "cache" in userRoles &&
        userRoles.cache.some((role) => adminRoleIds.includes(role.id));

      if (!hasAdminRole) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Not Authorized")
          .setDescription(
            "You do not have permission to use this command. Only users with configured admin roles can access config.",
          );

        await interaction.editReply({
          embeds: [errorEmbed],
        });
        return;
      }
    }

    // Show view selection menu
    const enabledModules: string[] =
      typeof guildConfig.enabled_modules === "string"
        ? JSON.parse(guildConfig.enabled_modules)
        : guildConfig.enabled_modules || [];
    const row = buildConfigViewMenuRow(enabledModules);

    const menuEmbed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Sentinel Command Center")
      .setDescription(
        "Manage your guild configuration via Discord or the high-performance Web Dashboard.",
      )
      .addFields({
        name: "Web Dashboard",
        value:
          "Access advanced configuration, map painting, and member management securely via your browser.",
      })
      .setFooter({
        text: isAdminGuild
          ? "System Administrator Mode // All Modules Unlocked"
          : "Server Management // Secure Auth Enabled",
      });

    const webDashboardRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("config_open_dashboard")
        .setLabel("Launch Web Dashboard")
        .setStyle(ButtonStyle.Success),
    );

    await interaction.editReply({
      embeds: [menuEmbed],
      components: [row, webDashboardRow],
    });
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
        flags: MessageFlags.Ephemeral,
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

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({
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

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // NOW defer after we have the data
    await interaction.deferUpdate();

    const moduleForView: Record<string, string | null> = {
      admin: null,
      revive: "revive",
      assist: "assist",
    };
    const requiredModule = moduleForView[selectedView];
    const enabledModules: string[] =
      typeof guildConfig.enabled_modules === "string"
        ? JSON.parse(guildConfig.enabled_modules)
        : guildConfig.enabled_modules || [];

    if (requiredModule && !enabledModules.includes(requiredModule)) {
      const disabledEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Module Not Enabled")
        .setDescription(
          `The **${selectedView.replace(/_/g, " ")}** module is not enabled for this guild. Use personal admin module management to enable it first.`,
        );

      await interaction.editReply({
        embeds: [disabledEmbed],
        components: [],
      });
      return;
    }

    if (selectedView === "revive") {
      await reviveHandlers.handleShowReviveSettings(interaction, true);
    } else if (selectedView === "assist") {
      await assistHandlers.handleShowAssistSettings(interaction, true);
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

    const menuEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Guild Configuration")
      .setDescription("Select a settings section to manage:")
      .setFooter({
        text: isAdminGuild
          ? "Admin Guild - Full control available"
          : "User Guild - Contact admin to modify",
      });

    await interaction.editReply({
      embeds: [menuEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in back to menu handler:", errorMsg);
  }
}

export async function handleEditLogChannelButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

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

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Log Channel Configuration")
      .setDescription(
        guildConfig?.log_channel_id
          ? `Currently set to <#${guildConfig.log_channel_id}>\n\nSelect a new channel or clear the current one.`
          : "No log channel set. Select a text channel to enable logging.",
      );

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

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Log Channel Updated")
      .setDescription(`Log channel set to ${selectedChannel}`);

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

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Log Channel Cleared")
      .setDescription("Logging has been disabled.");

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
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const roleSelectMenu = new RoleSelectMenuBuilder()
      .setCustomId("config_admin_roles_select")
      .setPlaceholder("Select admin roles...")
      .setMinValues(0)
      .setMaxValues(25);

    const row = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      roleSelectMenu,
    );

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Manage Admin Roles")
      .setDescription(
        "Select roles that are allowed to use the /config command. If no roles are selected, anyone can use /config.",
      );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
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
        .setTitle("❌ Failed to Update Admin Roles")
        .setDescription(error instanceof Error ? error.message : String(error));

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

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Admin Roles Updated")
      .setDescription(`Allowed roles:\n${rolesDisplay}`);

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
  interaction: ButtonInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return reviveHandlers.handleShowReviveSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleReviveSetRequestChannel(
  interaction: ButtonInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveSetRequestChannel(interaction);
}

export async function handleReviveSetOutputChannel(
  interaction: ButtonInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveSetOutputChannel(interaction);
}

export async function handleReviveSetPingRole(
  interaction: ButtonInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveSetPingRole(interaction);
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

export async function handleReviveRefreshPanel(
  interaction: ButtonInteraction,
): Promise<void> {
  return reviveHandlers.handleReviveRefreshPanel(interaction);
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
  interaction: ButtonInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return assistHandlers.handleShowAssistSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleAssistSetChannel(
  interaction: ButtonInteraction,
): Promise<void> {
  return assistHandlers.handleAssistSetChannel(interaction);
}

export async function handleAssistSetPingRole(
  interaction: ButtonInteraction,
): Promise<void> {
  return assistHandlers.handleAssistSetPingRole(interaction);
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

export async function handleAssistSetScriptRoles(
  interaction: ButtonInteraction,
): Promise<void> {
  return assistHandlers.handleAssistSetScriptRoles(interaction);
}

export async function handleAssistScriptRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  return assistHandlers.handleAssistScriptRolesSelect(interaction);
}

export async function handleAssistManageUsers(
  interaction: ButtonInteraction,
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

export async function handleOpenDashboard(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const magicLinkService = new MagicLinkService(interaction.client);
    const token = await magicLinkService.createToken({
      discordId: interaction.user.id,
      guildId: guildId,
      scope: "all",
      targetPath: "/config",
    });

    const apiUrl = getApiUrl();
    const magicLink = `${apiUrl}/api/auth/magic-link?token=${token}`;

    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("Access Granted")
      .setDescription(
        "Your secure configuration link is ready. This link is single-use and will burn after activation.",
      )
      .addFields({
        name: "Security Warning",
        value:
          "Never share this link with anyone. It grants access to your server's configuration.",
      })
      .setFooter({ text: "Link expires 15 minutes after inactivity" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Open Dashboard")
        .setURL(magicLink)
        .setStyle(ButtonStyle.Link),
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error generating config link:", errorMsg);
    await interaction.editReply({
      content: `❌ Error: ${errorMsg}`,
    });
  }
}
