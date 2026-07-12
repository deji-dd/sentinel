/* eslint-disable @typescript-eslint/no-explicit-any */
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
import {
  GuildConfigs,
  GuildApiKeys,
  decryptApiKey,
  encryptApiKey,
  tornApi,
} from "@sentinel/shared";
import { logGuildError, logGuildSuccess } from "../../../lib/guild-logger.js";

import * as verifyHandlers from "./handlers/verify.js";
import * as territoriesHandlers from "./handlers/territories.js";
import * as bazaarMugHandlers from "./handlers/bazaar-mug.js";
import * as reactionRolesHandlers from "./handlers/reaction-roles.js";

const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;

type ConfigComponentRow = ActionRowBuilder<
  StringSelectMenuBuilder | ButtonBuilder
>;

if (!botOwnerId) {
  throw new Error("Missing SENTINEL_DISCORD_USER_ID environment variable");
}

/**
 * Helper to safely parse array structures from NoSQL or legacy JSON strings
 */
function parseArray(val: any): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    return JSON.parse(val);
  } catch {
    return [];
  }
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

  const guildConfig = GuildConfigs.find({ guild_id: guildId })[0];

  if (!guildConfig) {
    return {
      allowed: false,
      reason:
        "This server is not yet initialized in Sentinel. Please contact a server administrator or the bot owner.",
    };
  }

  const adminRoleIds = parseArray(guildConfig.admin_role_ids);

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

    // Check NoSQL config
    let guildConfig = GuildConfigs.find({ guild_id: effectiveGuildId })[0];

    if (!guildConfig && isAdminGuild) {
      guildConfig = GuildConfigs.insertOne({
        id: randomUUID(),
        guild_id: effectiveGuildId,
        enabled_modules: ["admin"],
        admin_role_ids: [],
        verified_role_ids: [],
        auto_verify: false,
        nickname_template: "[{faction_tag}] {name} [{id}]",
        verified_role_id: null,
        log_channel_id: null,
        faction_list_channel_id: null,
        faction_list_message_ids: [],
        tt_full_channel_id: null,
        tt_filtered_channel_id: null,
        tt_territory_ids: [],
        tt_faction_ids: [],
      });
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

    const enabledModules = parseArray(guildConfig.enabled_modules);
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
  }
}

export async function handleViewSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    const selectedView = interaction.values[0];

    if (!guildId) return;

    const guildConfig = GuildConfigs.find({ guild_id: guildId })[0];

    if (!guildConfig) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Guild configuration not found.");
      await interaction.reply({ embeds: [errorEmbed], components: [] });
      return;
    }

    await interaction.deferUpdate();

    const enabledModules = parseArray(guildConfig.enabled_modules);

    if (selectedView !== "admin" && !enabledModules.includes(selectedView)) {
      const disabledEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Module Not Enabled")
        .setDescription(
          `The **${selectedView.replace(/_/g, " ")}** module is not enabled for this guild.`,
        );

      await interaction.editReply({ embeds: [disabledEmbed], components: [] });
      return;
    }

    if (selectedView !== "admin") {
      const keys = GuildApiKeys.find({ guild_id: guildId });
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

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          backBtn,
        );
        await interaction.editReply({
          embeds: [errorEmbed],
          components: [row],
        });
        return;
      }
    }

    if (selectedView === "verify") {
      await verifyHandlers.handleShowVerifySettings(interaction, true);
    } else if (selectedView === "territories") {
      await territoriesHandlers.handleShowTerritoriesSettings(
        interaction,
        true,
      );
    } else if (selectedView === "bazaar_mug") {
      await bazaarMugHandlers.handleShowBazaarMugSettings(interaction, true);
    } else if (selectedView === "reaction_roles") {
      await reactionRolesHandlers.handleShowReactionRolesSettings(
        interaction,
        true,
      );
    } else if (selectedView === "admin") {
      await handleShowAdminSettings(interaction, true);
    } else {
      const footerText = interaction.message.embeds[0]?.footer?.text;
      const originalUserId = getSessionUserId(footerText, interaction.user.id);
      await showScaffoldedModule(interaction, selectedView, originalUserId);
    }
  } catch (error) {
    console.error("Error in view select handler:", error);
  }
}

export async function handleBackToMenu(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const guildConfig = GuildConfigs.find({ guild_id: guildId })[0];
    const enabledModules = parseArray(guildConfig?.enabled_modules);
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
    console.error("Error in back to menu handler:", error);
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

    const guildConfig = GuildConfigs.find({ guild_id: guildId })[0];

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
      .setFooter({ text: `Sentinel • Config Session: ${originalUserId}` })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [menuRow, buttonRow],
    });
  } catch (error) {
    console.error("Error in edit log channel button handler:", error);
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
      await interaction.editReply({ embeds: [errorEmbed], components: [] });
      return;
    }

    const guildConfig = GuildConfigs.find({ guild_id: guildId })[0];
    if (guildConfig) {
      guildConfig.log_channel_id = selectedChannel.id;
      GuildConfigs.insertOne(guildConfig);
    }

    const footerText = interaction.message?.embeds?.[0]?.footer?.text;
    const originalUserId = getSessionUserId(footerText, interaction.user.id);

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Log Channel Updated")
      .setDescription(`Log channel set to ${selectedChannel}`)
      .setFooter({ text: `Sentinel • Config Session: ${originalUserId}` })
      .setTimestamp();

    await logGuildSuccess(
      guildId,
      interaction.client,
      "Log Channel Updated",
      `${interaction.user} updated the log channel.`,
      [{ name: "Channel", value: selectedChannel.toString(), inline: false }],
    );

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_admin_settings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({ embeds: [successEmbed], components: [row] });
  } catch (error) {
    console.error("Error in log channel select handler:", error);
  }
}

export async function handleClearLogChannel(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    if (!guildId) return;

    const guildConfig = GuildConfigs.find({ guild_id: guildId })[0];
    if (guildConfig) {
      guildConfig.log_channel_id = null;
      GuildConfigs.insertOne(guildConfig);
    }

    const footerText = interaction.message?.embeds?.[0]?.footer?.text;
    const originalUserId = getSessionUserId(footerText, interaction.user.id);

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Log Channel Cleared")
      .setDescription("Logging has been disabled.")
      .setFooter({ text: `Sentinel • Config Session: ${originalUserId}` })
      .setTimestamp();

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

    await interaction.editReply({ embeds: [successEmbed], components: [row] });
  } catch (error) {
    console.error("Error in clear log channel handler:", error);
  }
}

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

    const guildConfig = GuildConfigs.find({ guild_id: guildId })[0];
    const adminRoleIds = parseArray(guildConfig?.admin_role_ids);

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
      .setFooter({ text: `Sentinel • Config Session: ${originalUserId}` })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [menuRow, buttonRow],
    });
  } catch (error) {
    console.error("Error in edit admin roles handler:", error);
  }
}

export async function handleAdminRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const selectedRoleIds = interaction.values;
    if (!guildId) return;

    const guildConfig = GuildConfigs.find({ guild_id: guildId })[0];
    if (guildConfig) {
      guildConfig.admin_role_ids = selectedRoleIds;
      GuildConfigs.insertOne(guildConfig);
    }

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
      .setFooter({ text: `Sentinel • Config Session: ${originalUserId}` })
      .setTimestamp();

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_admin_settings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({ embeds: [successEmbed], components: [row] });
    await logGuildSuccess(
      guildId,
      interaction.client,
      "Admin Roles Updated",
      `${interaction.user} updated admin roles.`,
    );
  } catch (error) {
    console.error("Error in admin roles select handler:", error);
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

    let guildConfig = GuildConfigs.find({ guild_id: guildId })[0];
    if (!guildConfig) {
      GuildConfigs.insertOne({
        id: randomUUID(),
        guild_id: guildId,
        enabled_modules: ["admin"],
        admin_role_ids: [],
        verified_role_ids: [],
        auto_verify: false,
        nickname_template: "[{faction_tag}] {name} [{id}]",
        verified_role_id: null,
        log_channel_id: null,
        faction_list_channel_id: null,
        faction_list_message_ids: [],
        tt_full_channel_id: null,
        tt_filtered_channel_id: null,
        tt_territory_ids: [],
        tt_faction_ids: [],
      });
      await logGuildSuccess(
        guildId,
        interaction.client,
        "Guild Config Initialized",
        `Guild configuration initialized by bot owner ${interaction.user}.`,
      );
    }
    await handleBackToMenu(interaction);
  } catch (error) {
    console.error("Error in guild initialization handler:", error);
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
    .setFooter({ text: `Sentinel • Config Session: ${originalUserId}` })
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

    const keysData = GuildApiKeys.find({ guild_id: guildId });
    const footerText = interaction.message?.embeds?.[0]?.footer?.text;
    const originalUserId = getSessionUserId(footerText, interaction.user.id);

    let apiKeyDisplay = "No API keys configured for this server.";
    if (keysData.length > 0) {
      apiKeyDisplay = keysData
        .map((row: any) => {
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
        "Add or remove API keys used for guild operations.\n\n**Active Keys:**\n" +
          apiKeyDisplay,
      )
      .setFooter({ text: `Sentinel • Config Session: ${originalUserId}` })
      .setTimestamp();

    const components: any[] = [];
    if (keysData.length > 0) {
      const removeSelect = new StringSelectMenuBuilder()
        .setCustomId("config_remove_api_key_select")
        .setPlaceholder("Select a key to remove...");

      const options = keysData.map((row: any) => {
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

    await interaction.editReply({ embeds: [embed], components });
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

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(keyInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(primaryInput),
    );

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

    if (!/^[a-zA-Z0-9]{16}$/.test(apiKey)) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Invalid API Key")
        .setDescription("API Key must be exactly 16 alphanumeric characters.");
      const reply = await interaction.followUp({
        embeds: [errorEmbed],
        fetchReply: true,
      });
      setTimeout(() => reply.delete().catch(() => {}), 8000);
      return;
    }

    let keyInfo;
    try {
      const response = await tornApi.get("/user/basic", { apiKey });
      keyInfo = { playerId: response.profile?.id };
      if (!keyInfo.playerId)
        throw new Error("Invalid key or missing player ID");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("API Key Validation Failed")
        .setDescription(msg);
      const reply = await interaction.followUp({
        embeds: [errorEmbed],
        fetchReply: true,
      });
      setTimeout(() => reply.delete().catch(() => {}), 8000);
      return;
    }

    const encryptedKey = encryptApiKey(apiKey, process.env.ENCRYPTION_KEY!);

    // De-primary existing keys if needed
    if (isPrimary) {
      const existingPrimaries = GuildApiKeys.find({
        guild_id: guildId,
        is_primary: true,
      });
      for (const existing of existingPrimaries) {
        existing.is_primary = false;
        GuildApiKeys.insertOne(existing);
      }
    }

    GuildApiKeys.insertOne({
      id: randomUUID(),
      guild_id: guildId,
      user_id: keyInfo.playerId,
      api_key_encrypted: encryptedKey,
      provided_by: interaction.user.id,
      is_primary: isPrimary,
    });

    const maskedKey = `•••• •••• •••• ${apiKey.slice(-4)}`;
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

    await handleShowApiKeys(interaction, true);
  } catch (error) {
    console.error("Error in add API key modal handler:", error);
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
    const keyRow = GuildApiKeys.findOne(selectedId);

    if (!keyRow || keyRow.guild_id !== guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("The selected API key was not found.");
      const reply = await interaction.followUp({
        embeds: [errorEmbed],
        fetchReply: true,
      });
      setTimeout(() => reply.delete().catch(() => {}), 8000);
      return;
    }

    let decryptedKey = "";
    try {
      decryptedKey = decryptApiKey(
        keyRow.api_key_encrypted,
        process.env.ENCRYPTION_KEY!,
      );
    } catch {
      decryptedKey = "Unknown Key";
    }

    GuildApiKeys.delete(selectedId);

    const maskedKey =
      decryptedKey !== "Unknown Key"
        ? `•••• •••• •••• ${decryptedKey.slice(-4)}`
        : "Unknown Key";
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

    await handleShowApiKeys(interaction, true);
  } catch (error) {
    console.error("Error in remove API key select handler:", error);
  }
}

// ----------------------------------------------------------------------
// Re-Export Routing Functions
// ----------------------------------------------------------------------
export async function handleShowTerritoriesSettings(
  interaction: territoriesHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
) {
  return territoriesHandlers.handleShowTerritoriesSettings(
    interaction,
    isAlreadyDeferred,
  );
}
export async function handleTerritoriesSettingSelect(
  interaction: StringSelectMenuInteraction,
) {
  return territoriesHandlers.handleTerritoriesSettingSelect(interaction);
}
export async function handleTerritoriesSetFullChannel(
  interaction: territoriesHandlers.ConfigInteraction,
) {
  return territoriesHandlers.handleTerritoriesSetFullChannel(interaction);
}
export async function handleTerritoriesSetFilteredChannel(
  interaction: territoriesHandlers.ConfigInteraction,
) {
  return territoriesHandlers.handleTerritoriesSetFilteredChannel(interaction);
}
export async function handleTerritoriesFullChannelSelect(
  interaction: ChannelSelectMenuInteraction,
) {
  return territoriesHandlers.handleTerritoriesFullChannelSelect(interaction);
}
export async function handleTerritoriesFilteredChannelSelect(
  interaction: ChannelSelectMenuInteraction,
) {
  return territoriesHandlers.handleTerritoriesFilteredChannelSelect(
    interaction,
  );
}
export async function handleShowWatchedTerritoriesSettings(
  interaction: territoriesHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
) {
  return territoriesHandlers.handleShowWatchedTerritoriesSettings(
    interaction,
    isAlreadyDeferred,
  );
}
export async function handleTerritoriesSetWatchedTerritoriesBtn(
  interaction: ButtonInteraction,
) {
  return territoriesHandlers.handleTerritoriesSetWatchedTerritoriesBtn(
    interaction,
  );
}
export async function handleTerritoriesWatchedTerritoriesModal(
  interaction: ModalSubmitInteraction,
) {
  return territoriesHandlers.handleTerritoriesWatchedTerritoriesModal(
    interaction,
  );
}
export async function handleShowWatchedFactionsSettings(
  interaction: territoriesHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
) {
  return territoriesHandlers.handleShowWatchedFactionsSettings(
    interaction,
    isAlreadyDeferred,
  );
}
export async function handleTerritoriesSetWatchedFactionsBtn(
  interaction: ButtonInteraction,
) {
  return territoriesHandlers.handleTerritoriesSetWatchedFactionsBtn(
    interaction,
  );
}
export async function handleTerritoriesWatchedFactionsModal(
  interaction: ModalSubmitInteraction,
) {
  return territoriesHandlers.handleTerritoriesWatchedFactionsModal(interaction);
}

export async function handleShowBazaarMugSettings(
  interaction: bazaarMugHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
) {
  return bazaarMugHandlers.handleShowBazaarMugSettings(
    interaction,
    isAlreadyDeferred,
  );
}
export async function handleBazaarMugSettingSelect(
  interaction: StringSelectMenuInteraction,
) {
  return bazaarMugHandlers.handleBazaarMugSettingSelect(interaction);
}
export async function handleBazaarMugToggle(
  interaction: bazaarMugHandlers.ConfigInteraction,
) {
  return bazaarMugHandlers.handleBazaarMugToggle(interaction);
}
export async function handleBazaarMugSetChannel(
  interaction: bazaarMugHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
) {
  return bazaarMugHandlers.handleBazaarMugSetChannel(
    interaction,
    isAlreadyDeferred,
  );
}
export async function handleBazaarMugChannelSelect(
  interaction: ChannelSelectMenuInteraction,
) {
  return bazaarMugHandlers.handleBazaarMugChannelSelect(interaction);
}
export async function handleBazaarMugClearChannelBtn(
  interaction: ButtonInteraction,
) {
  return bazaarMugHandlers.handleBazaarMugClearChannelBtn(interaction);
}
export async function handleShowBazaarMugRoleSettings(
  interaction: bazaarMugHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
) {
  return bazaarMugHandlers.handleShowBazaarMugRoleSettings(
    interaction,
    isAlreadyDeferred,
  );
}
export async function handleBazaarMugRoleSelect(
  interaction: RoleSelectMenuInteraction,
) {
  return bazaarMugHandlers.handleBazaarMugRoleSelect(interaction);
}
export async function handleBazaarMugClearRoleBtn(
  interaction: ButtonInteraction,
) {
  return bazaarMugHandlers.handleBazaarMugClearRoleBtn(interaction);
}
export async function handleShowBazaarMugThresholdSettings(
  interaction: bazaarMugHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
) {
  return bazaarMugHandlers.handleShowBazaarMugThresholdSettings(
    interaction,
    isAlreadyDeferred,
  );
}
export async function handleBazaarMugSetThresholdBtn(
  interaction: ButtonInteraction,
) {
  return bazaarMugHandlers.handleBazaarMugSetThresholdBtn(interaction);
}
export async function handleBazaarMugThresholdModal(
  interaction: ModalSubmitInteraction,
) {
  return bazaarMugHandlers.handleBazaarMugThresholdModal(interaction);
}
export async function handleShowBazaarMugMinOfflineSettings(
  interaction: bazaarMugHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
) {
  return bazaarMugHandlers.handleShowBazaarMugMinOfflineSettings(
    interaction,
    isAlreadyDeferred,
  );
}
export async function handleBazaarMugSetMinOfflineBtn(
  interaction: ButtonInteraction,
) {
  return bazaarMugHandlers.handleBazaarMugSetMinOfflineBtn(interaction);
}
export async function handleBazaarMugMinOfflineModal(
  interaction: ModalSubmitInteraction,
) {
  return bazaarMugHandlers.handleBazaarMugMinOfflineModal(interaction);
}
export async function handleShowBazaarMugWatchlistSettings(
  interaction: bazaarMugHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
) {
  return bazaarMugHandlers.handleShowBazaarMugWatchlistSettings(
    interaction,
    isAlreadyDeferred,
  );
}
export async function handleBazaarMugEditWatchlistBtn(
  interaction: ButtonInteraction,
) {
  return bazaarMugHandlers.handleBazaarMugEditWatchlistBtn(interaction);
}
export async function handleBazaarMugWatchlistModal(
  interaction: ModalSubmitInteraction,
) {
  return bazaarMugHandlers.handleBazaarMugWatchlistModal(interaction);
}

export async function handleShowReactionRolesSettings(
  interaction: reactionRolesHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
) {
  return reactionRolesHandlers.handleShowReactionRolesSettings(
    interaction,
    isAlreadyDeferred,
  );
}
export async function handleReactionRolesSettingSelect(
  interaction: StringSelectMenuInteraction,
) {
  return reactionRolesHandlers.handleReactionRolesSettingSelect(interaction);
}
export async function handleReactionRolesAddMessage(
  interaction: reactionRolesHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
) {
  return reactionRolesHandlers.handleReactionRolesAddMessage(
    interaction,
    isAlreadyDeferred,
  );
}
export async function handleReactionRolesChannelSelect(
  interaction: ChannelSelectMenuInteraction,
) {
  return reactionRolesHandlers.handleReactionRolesChannelSelect(interaction);
}
export async function handleReactionRolesRolesSelect(
  interaction: RoleSelectMenuInteraction,
) {
  return reactionRolesHandlers.handleReactionRolesRolesSelect(interaction);
}
export async function handleReactionRolesFillDetails(
  interaction: ButtonInteraction,
) {
  return reactionRolesHandlers.handleReactionRolesFillDetails(interaction);
}
export async function handleReactionRolesModalSubmit(
  interaction: ModalSubmitInteraction,
) {
  return reactionRolesHandlers.handleReactionRolesModalSubmit(interaction);
}
export async function handleShowManageExistingMessages(
  interaction: reactionRolesHandlers.ConfigInteraction,
  isAlreadyDeferred = false,
) {
  return reactionRolesHandlers.handleShowManageExistingMessages(
    interaction,
    isAlreadyDeferred,
  );
}
export async function handleReactionRolesSelectMessage(
  interaction: StringSelectMenuInteraction,
) {
  return reactionRolesHandlers.handleReactionRolesSelectMessage(interaction);
}
export async function handleReactionRoleDeleteMsgBtn(
  interaction: ButtonInteraction,
) {
  return reactionRolesHandlers.handleReactionRoleDeleteMsgBtn(interaction);
}
export async function handleReactionRolesRequiredRolesSelect(
  interaction: RoleSelectMenuInteraction,
) {
  return reactionRolesHandlers.handleReactionRolesRequiredRolesSelect(
    interaction,
  );
}
export async function handleReactionRolesSkipRequiredRoles(
  interaction: ButtonInteraction,
) {
  return reactionRolesHandlers.handleReactionRolesSkipRequiredRoles(
    interaction,
  );
}
export async function handleReactionRolesBackToRequiredRoles(
  interaction: ButtonInteraction,
) {
  return reactionRolesHandlers.handleReactionRolesBackToRequiredRoles(
    interaction,
  );
}
export async function handleReactionRolesBackToMappedRoles(
  interaction: ButtonInteraction,
) {
  return reactionRolesHandlers.handleReactionRolesBackToMappedRoles(
    interaction,
  );
}
