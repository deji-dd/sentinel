import {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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
import { getGuildApiKeys } from "../../../lib/guild-api-keys.js";
import {
  fetchAndStoreFactionNames,
  validateAndFetchFactionDetails,
  storeFactionDetails,
} from "../../../lib/faction-utils.js";
import { logGuildError, logGuildSuccess } from "../../../lib/guild-logger.js";
import * as territoryHandlers from "./handlers/territories.js";
import * as reactionRolesHandlers from "./handlers/reaction-roles.js";
import * as reviveHandlers from "./handlers/revive.js";
import * as assistHandlers from "./handlers/assist.js";
import { db } from "../../../lib/db-client.js";
import { updateFactionList } from "../../../lib/faction-list-manager.js";
import { MagicLinkService } from "../../../lib/services/magic-link-service.js";
import { getApiUrl } from "../../../lib/bot-config.js";

interface GuildConfigView {
  log_channel_id: string | null;
  admin_role_ids: string | null;
  auto_verify: number | null;
  verified_role_id: string | null;
  nickname_template: string | null;
  faction_list_channel_id: string | null;
}

const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;

if (!botOwnerId) {
  throw new Error("Missing SENTINEL_DISCORD_USER_ID environment variable");
}

function buildConfigViewMenuRow(
  enabledModules: string[] = [],
): ActionRowBuilder<StringSelectMenuBuilder> {
  const options: StringSelectMenuOptionBuilder[] = [];

  if (enabledModules.includes("verify")) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel("Verification Settings")
        .setValue("verify")
        .setDescription("Manage verification settings"),
    );
  }

  if (enabledModules.includes("territories")) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel("Territories Settings")
        .setValue("territories")
        .setDescription("Manage TT notifications and filters"),
    );
  }

  if (enabledModules.includes("reaction_roles")) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel("Reaction Roles")
        .setValue("reaction_roles")
        .setDescription("Self-assignable roles via emoji reactions"),
    );
  }

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
      verify: "verify",
      territories: "territories",
      reaction_roles: "reaction_roles",
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

    if (selectedView === "verify") {
      await showVerifySettings(interaction, guildConfig);
    } else if (selectedView === "territories") {
      await territoryHandlers.handleShowTTSettings(interaction);
    } else if (selectedView === "reaction_roles") {
      await reactionRolesHandlers.handleShowReactionRolesSettings(
        interaction,
        true,
      );
    } else if (selectedView === "revive") {
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

async function showVerifySettings(
  interaction:
    | StringSelectMenuInteraction
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ChannelSelectMenuInteraction
    | RoleSelectMenuInteraction
    | ModalSubmitInteraction,
  guildConfig: GuildConfigView,
): Promise<void> {
  // Fetch faction role mappings
  const factionRoles = await db
    .selectFrom(TABLE_NAMES.FACTION_ROLES)
    .selectAll()
    .where("guild_id", "=", interaction.guildId)
    .orderBy("faction_name", "asc")
    .orderBy("faction_id", "asc")
    .execute();

  const guildId = interaction.guildId;
  const apiKeys = guildId ? await getGuildApiKeys(guildId) : [];
  const hasApiKey = apiKeys.length > 0;

  // Format faction roles display - show count instead of listing
  let factionRolesDisplay = "None configured";
  if (factionRoles && factionRoles.length > 0) {
    factionRolesDisplay = `${factionRoles.length} faction role mapping${factionRoles.length !== 1 ? "s" : ""}`;
  }

  const autoVerifyStatus = guildConfig.auto_verify
    ? "<:Green:1474607376140079104>"
    : "<:Red:1474607810368114886>";

  const verifiedRoleDisplay = guildConfig.verified_role_id
    ? `<@&${guildConfig.verified_role_id}>`
    : "Not configured";

  const verifyEmbed = new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle("Verification Settings")
    .addFields(
      {
        name: "Auto Verification",
        value: `${autoVerifyStatus} ${guildConfig.auto_verify ? "Enabled" : "Disabled"}`,
        inline: false,
      },
      {
        name: "Nickname Template",
        value: `\`${guildConfig.nickname_template || "{name}#{id}"}\``,
        inline: false,
      },
      {
        name: "Faction List Channel",
        value: guildConfig.faction_list_channel_id
          ? `<#${guildConfig.faction_list_channel_id}>`
          : "Not configured",
        inline: false,
      },
    );

  verifyEmbed.addFields(
    {
      name: "Verification Role",
      value: verifiedRoleDisplay,
      inline: false,
    },
    {
      name: "Faction Role Assignments",
      value: factionRolesDisplay,
      inline: false,
    },
  );

  if (!hasApiKey) {
    verifyEmbed.addFields({
      name: "Warning",
      value: "No API key configured - verification commands will not work",
      inline: false,
    });
  }

  // Edit settings menu
  const settingOptions = [
    new StringSelectMenuOptionBuilder()
      .setLabel("Auto Verification")
      .setValue("edit_auto_verify")
      .setDescription(
        guildConfig.auto_verify ? "Currently enabled" : "Currently disabled",
      ),
    new StringSelectMenuOptionBuilder()
      .setLabel("Nickname Template")
      .setValue("edit_nickname")
      .setDescription("e.g., {name}#{id}"),
    new StringSelectMenuOptionBuilder()
      .setLabel("Faction List Channel")
      .setValue("edit_faction_list_channel")
      .setDescription("Channel for faction role map output"),
  ];

  settingOptions.push(
    new StringSelectMenuOptionBuilder()
      .setLabel("Verification Role")
      .setValue("edit_verified_role")
      .setDescription("Role for all verified members"),
    new StringSelectMenuOptionBuilder()
      .setLabel("Faction Roles")
      .setValue("edit_faction")
      .setDescription("Manage role assignments"),
  );

  const settingsMenu = new StringSelectMenuBuilder()
    .setCustomId("verify_settings_edit")
    .setPlaceholder("Select setting to edit...")
    .addOptions(settingOptions);

  const backBtn = new ButtonBuilder()
    .setCustomId("config_back_to_menu")
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    settingsMenu,
  );

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    backBtn,
  );

  await interaction.editReply({
    embeds: [verifyEmbed],
    components: [menuRow, buttonRow],
  });
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

export async function handleBackToVerifySettings(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!guildConfig) return;

    // Create a mock StringSelectMenuInteraction to reuse showVerifySettings
    // Since we can't directly pass ButtonInteraction to showVerifySettings,
    // we'll inline the display logic here
    const factionRoles = await db
      .selectFrom(TABLE_NAMES.FACTION_ROLES)
      .selectAll()
      .where("guild_id", "=", guildId)
      .orderBy("faction_name", "asc")
      .orderBy("faction_id", "asc")
      .execute();

    const apiKeys = await getGuildApiKeys(guildId);
    const hasApiKey = apiKeys.length > 0;

    let factionRolesDisplay = "None configured";
    if (factionRoles && factionRoles.length > 0) {
      // Fetch faction names for display (if API key available)
      const missingNames = factionRoles.filter((fr) => !fr.faction_name);
      if (missingNames.length > 0) {
        const activeApiKey = (await getGuildApiKeys(guildId))[0];
        if (activeApiKey) {
          try {
            const factionIds = missingNames.map((fr) => fr.faction_id);
            await fetchAndStoreFactionNames(factionIds, activeApiKey);
          } catch (error) {
            console.error("Error decrypting API key:", error);
          }
        }
      }

      factionRolesDisplay = factionRoles
        .map((fr) => {
          const factionName = fr.faction_name || `Faction ${fr.faction_id}`;
          const enabled = Number(fr.enabled) !== 0; // SQLite stores as 0/1
          const statusEmoji = enabled
            ? "<:Green:1474607376140079104>"
            : "<:Red:1474607810368114886>";

          let rolesText = "";

          // Parse JSON arrays
          const memberRoleIds: string[] =
            typeof fr.member_role_ids === "string"
              ? JSON.parse(fr.member_role_ids)
              : fr.member_role_ids || [];
          const leaderRoleIds: string[] =
            typeof fr.leader_role_ids === "string"
              ? JSON.parse(fr.leader_role_ids)
              : fr.leader_role_ids || [];

          // Show member roles
          if (memberRoleIds && memberRoleIds.length > 0) {
            const memberRoles = memberRoleIds
              .map((roleId) => `<@&${roleId}>`)
              .join(", ");
            rolesText += `Members: ${memberRoles}`;
          }

          // Show leader roles if configured
          if (leaderRoleIds && leaderRoleIds.length > 0) {
            const leaderRoles = leaderRoleIds
              .map((roleId) => `<@&${roleId}>`)
              .join(", ");
            rolesText += (rolesText ? " | " : "") + `Leaders: ${leaderRoles}`;
          }

          if (!rolesText) {
            rolesText = "No roles configured";
          }

          return `${statusEmoji} **${factionName}**: ${rolesText}`;
        })
        .join("\n");
    }

    const autoVerifyStatus = guildConfig.auto_verify
      ? "<:Green:1474607376140079104>"
      : "<:Red:1474607810368114886>";

    const verifiedRoleDisplay = guildConfig.verified_role_id
      ? `<@&${guildConfig.verified_role_id}>`
      : "Not configured";

    const verifyEmbed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("Verification Settings")
      .addFields(
        {
          name: "Auto Verification",
          value: `${autoVerifyStatus} ${guildConfig.auto_verify ? "Enabled" : "Disabled"}`,
          inline: false,
        },
        {
          name: "Nickname Template",
          value: `\`${guildConfig.nickname_template || "{name}#{id}"}\``,
          inline: false,
        },
      );

    verifyEmbed.addFields(
      {
        name: "Verification Role",
        value: verifiedRoleDisplay,
        inline: false,
      },
      {
        name: "Faction Role Assignments",
        value: factionRolesDisplay,
        inline: false,
      },
    );

    if (!hasApiKey) {
      verifyEmbed.addFields({
        name: "Warning",
        value: "No API key configured - verification commands will not work",
        inline: false,
      });
    }

    const settingOptions = [
      new StringSelectMenuOptionBuilder()
        .setLabel("Auto Verification")
        .setValue("edit_auto_verify")
        .setDescription(
          guildConfig.auto_verify ? "Currently enabled" : "Currently disabled",
        ),
      new StringSelectMenuOptionBuilder()
        .setLabel("Nickname Template")
        .setValue("edit_nickname")
        .setDescription("e.g., {name}#{id}"),
    ];

    settingOptions.push(
      new StringSelectMenuOptionBuilder()
        .setLabel("Verification Role")
        .setValue("edit_verified_role")
        .setDescription("Role for all verified members"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Faction Roles")
        .setValue("edit_faction")
        .setDescription("Manage role assignments"),
    );

    const settingsMenu = new StringSelectMenuBuilder()
      .setCustomId("verify_settings_edit")
      .setPlaceholder("Select setting to edit...")
      .addOptions(settingOptions);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_to_menu")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const menuRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        settingsMenu,
      );

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      backBtn,
    );

    await interaction.editReply({
      embeds: [verifyEmbed],
      components: [menuRow, buttonRow],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in back to verification settings handler:", errorMsg);
  }
}

// Handler for verify settings edit menu
export async function handleVerifySettingsEdit(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    const selectedSetting = interaction.values[0];

    if (!guildId) {
      await interaction.deferUpdate();
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

    // Get guild config
    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!guildConfig) {
      await interaction.deferUpdate();
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Guild configuration not found.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Extract active API key for faction lookups
    const apiKey = (await getGuildApiKeys(guildId))[0];

    if (selectedSetting === "edit_auto_verify") {
      await interaction.deferUpdate();
      // Show confirmation before toggling
      const currentStatus = guildConfig.auto_verify;
      const newStatus = !currentStatus;

      const confirmEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Confirm Change")
        .setDescription(
          `Turn auto-verification **${newStatus ? "on" : "off"}**?\n\n${newStatus ? "New members will be automatically verified on join" : "Members will need to manually run /verify"}`,
        );

      const confirmBtn = new ButtonBuilder()
        .setCustomId("confirm_auto_verify_toggle")
        .setLabel(newStatus ? "Enable" : "Disable")
        .setStyle(newStatus ? ButtonStyle.Success : ButtonStyle.Danger);

      const cancelBtn = new ButtonBuilder()
        .setCustomId("verify_settings_edit_cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        confirmBtn,
        cancelBtn,
      );

      await interaction.editReply({
        embeds: [confirmEmbed],
        components: [row],
      });
    } else if (selectedSetting === "edit_nickname") {
      // Show modal for nickname template
      const modal = new ModalBuilder()
        .setCustomId("config_nickname_template_modal")
        .setTitle("Edit Nickname Template");

      const templateInput = new TextInputBuilder()
        .setCustomId("nickname_template_input")
        .setLabel("Nickname Template")
        .setPlaceholder("e.g., {name} | {tag}")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(guildConfig.nickname_template || "{name}#{id}");

      const descriptionInput = new TextInputBuilder()
        .setCustomId("description_input")
        .setLabel("Available Variables")
        .setPlaceholder("Variables: {name}, {id}, {tag}")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue(
          "Variables:\n• {name} - Player name\n• {id} - Torn player ID\n• {tag} - Faction tag",
        );

      const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(
        templateInput,
      );
      const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(
        descriptionInput,
      );
      modal.addComponents(row1, row2);

      await interaction.showModal(modal);
    } else if (selectedSetting === "edit_faction") {
      await interaction.deferUpdate();
      // Show faction role management
      try {
        await showFactionRoleMenu(interaction, guildId, apiKey);
      } catch (factionError) {
        const factionMsg =
          factionError instanceof Error
            ? factionError.message
            : String(factionError);
        console.error("Error showing faction role menu:", factionMsg);
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("Error Loading Faction Roles")
          .setDescription(`Failed to load faction roles: ${factionMsg}`);
        await interaction.editReply({
          embeds: [errorEmbed],
          components: [],
        });
      }
    } else if (selectedSetting === "edit_verified_role") {
      await interaction.deferUpdate();
      // Show role selector for verification role
      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("Select Verification Role")
        .setDescription(
          "Choose a role to assign to all verified members.\nThis role is assigned before faction-specific roles.",
        );

      const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId("config_verified_role_select")
        .setPlaceholder("Select a role for verification");

      const row = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        roleSelect,
      );

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });
    } else if (selectedSetting === "edit_faction_list_channel") {
      await interaction.deferUpdate();
      // Show channel selector for faction list
      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("Select Faction List Channel")
        .setDescription(
          "Choose a channel where the bot will post and update the list of mapped factions.\nFactions will be sorted alphabetically.",
        );

      const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId("config_faction_list_channel_select")
        .setPlaceholder("Select a channel for faction list")
        .addChannelTypes(ChannelType.GuildText);

      const row =
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
          channelSelect,
        );

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in verification settings edit handler:", errorMsg);
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

async function showFactionRoleMenu(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  guildId: string,
  apiKey?: string,
  page: number = 1,
): Promise<void> {
  try {
    const factionRoles = await db
      .selectFrom(TABLE_NAMES.FACTION_ROLES)
      .selectAll()
      .where("guild_id", "=", guildId)
      .orderBy("faction_name", "asc")
      .orderBy("faction_id", "asc")
      .execute();

    let factionRolesDisplay =
      "None configured\n\nUse the **Add Faction** button below to get started.";
    const factionSelectOptions: StringSelectMenuOptionBuilder[] = [];
    const factionDisplayLines: string[] = [];

    // Pagination: 10 items per page
    const PAGE_SIZE = 10;
    const totalPages = Math.max(
      1,
      Math.ceil((factionRoles?.length || 0) / PAGE_SIZE),
    );
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = startIdx + PAGE_SIZE;

    if (factionRoles && factionRoles.length > 0) {
      // Get only the faction roles for the current page
      const pageFactionRoles = factionRoles.slice(startIdx, endIdx);

      // Fetch missing faction names ONLY for the current page
      const missingNames = pageFactionRoles.filter((fr) => !fr.faction_name);
      if (missingNames.length > 0 && apiKey) {
        try {
          const factionIds = missingNames.map((fr) => fr.faction_id);
          await fetchAndStoreFactionNames(factionIds, apiKey);

          // Re-fetch the page's faction roles to get updated names
          const updatedRoles = await db
            .selectFrom(TABLE_NAMES.FACTION_ROLES)
            .selectAll()
            .where("guild_id", "=", guildId)
            .where(
              "faction_id",
              "in",
              pageFactionRoles.map((fr) => fr.faction_id),
            )
            .orderBy("faction_name", "asc")
            .orderBy("faction_id", "asc")
            .execute();

          if (updatedRoles) {
            // Update the page faction roles with fetched names
            pageFactionRoles.forEach((fr, idx) => {
              const updated = updatedRoles.find(
                (ur) => ur.faction_id === fr.faction_id,
              );
              if (updated?.faction_name) {
                pageFactionRoles[idx] = updated;
              }
            });
          }
        } catch (fetchError) {
          console.error("Error fetching faction names:", fetchError);
          // Continue without faction names - they'll be populated later
        }
      }

      // Build options and display for current page only
      pageFactionRoles.forEach((fr) => {
        const factionName = fr.faction_name || `Faction ${fr.faction_id}`;
        const enabled = Number(fr.enabled) !== 0; // SQLite stores as 0/1
        const statusEmoji = enabled
          ? "<:Green:1474607376140079104>"
          : "<:Red:1474607810368114886>";

        // Add to select menu options
        factionSelectOptions.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`${factionName}`)
            .setDescription(
              `ID: ${fr.faction_id} • ${enabled ? "Enabled" : "Disabled"}`,
            )
            .setValue(`faction_manage_${fr.faction_id}`)
            .setEmoji(enabled ? "1474607376140079104" : "1474607810368114886"),
        );

        // Add to display lines
        factionDisplayLines.push(
          `${statusEmoji} **${factionName}** (${fr.faction_id})`,
        );
      });

      // Set display for current page
      if (factionDisplayLines.length > 0) {
        factionRolesDisplay = factionDisplayLines.join("\n");
      }
    }

    const factionEmbed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("Faction Role Management")
      .setDescription(
        "Select a faction below to manage its role assignments, or add a new faction.",
      )
      .addFields({
        name: "Configured Factions",
        value: factionRolesDisplay,
        inline: false,
      });

    // Add pagination info if needed
    if (totalPages > 1 && factionRoles && factionRoles.length > 0) {
      factionEmbed.setFooter({
        text: `Page ${currentPage}/${totalPages}`,
      });
    }

    const components: ActionRowBuilder<
      StringSelectMenuBuilder | ButtonBuilder
    >[] = [];

    // Add faction select menu if there are factions
    if (factionSelectOptions.length > 0) {
      const factionSelect = new StringSelectMenuBuilder()
        .setCustomId("config_faction_manage_select")
        .setPlaceholder("Select a faction to manage...")
        .addOptions(factionSelectOptions);

      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          factionSelect,
        ),
      );
    }

    // Add pagination buttons if needed
    if (totalPages > 1) {
      const prevBtn = new ButtonBuilder()
        .setCustomId(`config_faction_role_menu_prev_${currentPage - 1}`)
        .setLabel("← Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage <= 1);

      const nextBtn = new ButtonBuilder()
        .setCustomId(`config_faction_role_menu_next_${currentPage + 1}`)
        .setLabel("Next →")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages);

      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn),
      );
    }

    // Add action buttons
    const addBtn = new ButtonBuilder()
      .setCustomId("config_add_faction_role")
      .setLabel("Add Faction")
      .setStyle(ButtonStyle.Success);

    const removeBtn = new ButtonBuilder()
      .setCustomId("config_remove_faction_role")
      .setLabel("Remove Faction")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!factionRoles || factionRoles.length === 0);

    const backBtn = new ButtonBuilder()
      .setCustomId("verify_settings_edit_cancel")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        addBtn,
        removeBtn,
        backBtn,
      ),
    );

    await interaction.editReply({
      embeds: [factionEmbed],
      components: components,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in showFactionRoleMenu:", errorMsg);

    try {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription(errorMsg || "Failed to load faction roles.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
    } catch (replyError) {
      console.error("Failed to send error reply:", replyError);
    }
  }
}

/**
 * Handle faction role menu pagination
 */
export async function handleFactionRoleMenuPage(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const { customId } = interaction;
    const pageStr = customId.split("_").pop();
    const page = Number(pageStr) || 1;

    const guildId = interaction.guildId;
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

    const apiKeys = await getGuildApiKeys(guildId);
    const apiKey = apiKeys.length > 0 ? apiKeys[0] : undefined;

    await showFactionRoleMenu(interaction, guildId, apiKey, page);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in faction role menu pagination:", errorMsg);

    try {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription(errorMsg || "An unexpected error occurred.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
    } catch (replyError) {
      console.error("Failed to send error reply:", replyError);
    }
  }
}

async function showFactionManagePage(
  interaction:
    | StringSelectMenuInteraction
    | ButtonInteraction
    | RoleSelectMenuInteraction,
  factionId: number,
  _apiKey?: string,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;

  // Fetch faction mapping
  const factionMapping = await db
    .selectFrom(TABLE_NAMES.FACTION_ROLES)
    .selectAll()
    .where("guild_id", "=", guildId)
    .where("faction_id", "=", factionId)
    .executeTakeFirst();

  if (!factionMapping) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Error")
      .setDescription(
        `Faction ${factionId} not found in your server's configuration.`,
      );

    await interaction.editReply({
      embeds: [errorEmbed],
      components: [],
    });
    return;
  }

  const factionName = factionMapping.faction_name || `Faction ${factionId}`;
  const enabled = Number(factionMapping.enabled) !== 0; // SQLite stores as 0/1
  const memberRoleIds: string[] =
    typeof factionMapping.member_role_ids === "string"
      ? JSON.parse(factionMapping.member_role_ids)
      : factionMapping.member_role_ids || [];
  const leaderRoleIds: string[] =
    typeof factionMapping.leader_role_ids === "string"
      ? JSON.parse(factionMapping.leader_role_ids)
      : factionMapping.leader_role_ids || [];

  // Build description
  let description = `Configure role assignments for **${factionName}**.\n\n`;
  description += `**Status:** ${enabled ? "<:Green:1474607376140079104> Enabled" : "<:Red:1474607810368114886> Disabled"}\n\n`;
  description += `**Member Roles** (assigned to ALL faction members):\n`;
  description +=
    memberRoleIds.length > 0
      ? memberRoleIds.map((id) => `<@&${id}>`).join(", ")
      : "_None configured_";
  description += `\n\n**Leader Roles** (assigned ONLY to Leaders & Co-leaders):\n`;
  description +=
    leaderRoleIds.length > 0
      ? leaderRoleIds.map((id) => `<@&${id}>`).join(", ")
      : "_None configured_";

  const manageEmbed = new EmbedBuilder()
    .setColor(enabled ? 0x22c55e : 0xef4444)
    .setTitle(`Manage Faction: ${factionName}`)
    .setDescription(description)
    .setFooter({ text: `Faction ID: ${factionId}` });

  // Buttons
  const toggleBtn = new ButtonBuilder()
    .setCustomId(`config_faction_toggle_${factionId}`)
    .setLabel(enabled ? "Disable" : "Enable")
    .setStyle(enabled ? ButtonStyle.Secondary : ButtonStyle.Success);

  const memberRolesBtn = new ButtonBuilder()
    .setCustomId(`config_faction_member_roles_${factionId}`)
    .setLabel("Set Member Roles")
    .setStyle(ButtonStyle.Primary);

  const leaderRolesBtn = new ButtonBuilder()
    .setCustomId(`config_faction_leader_roles_${factionId}`)
    .setLabel("Set Leader Roles")
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId("config_faction_manage_back")
    .setLabel("Back to List")
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(toggleBtn);
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    memberRolesBtn,
    leaderRolesBtn,
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

  await interaction.editReply({
    embeds: [manageEmbed],
    components: [row1, row2, row3],
  });
}

// Cancel handler for verify settings submenu
export async function handleVerifySettingsEditCancel(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;

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

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    await showVerifySettings(interaction, guildConfig);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in cancel handler:", errorMsg);
  }
}

// Faction role and sync interval handlers
export async function handleAddFactionRoleButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const modal = new ModalBuilder()
      .setCustomId("config_add_faction_role_modal")
      .setTitle("Add Faction Role Mapping");

    const factionIdInput = new TextInputBuilder()
      .setCustomId("faction_id_input")
      .setLabel("Torn Faction ID")
      .setPlaceholder("Enter the numeric faction ID (e.g., 12345)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
      factionIdInput,
    );
    modal.addComponents(row);

    await interaction.showModal(modal);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in add faction role button handler:", errorMsg);
  }
}

export async function handleRemoveFactionRoleButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const modal = new ModalBuilder()
      .setCustomId("config_remove_faction_role_modal")
      .setTitle("Remove Faction Role Mapping");

    const factionIdInput = new TextInputBuilder()
      .setCustomId("faction_id_input")
      .setLabel("Torn Faction ID to Remove")
      .setPlaceholder("Enter the faction ID to remove mapping")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
      factionIdInput,
    );
    modal.addComponents(row);

    await interaction.showModal(modal);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in remove faction role button handler:", errorMsg);
  }
}

export async function handleAddFactionRoleModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const factionIdStr =
      interaction.fields.getTextInputValue("faction_id_input");
    const guildId = interaction.guildId;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Unable to determine guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    const factionId = parseInt(factionIdStr, 10);
    if (isNaN(factionId)) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Invalid Faction ID")
        .setDescription("Faction ID must be a valid number.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    const apiKey = (await getGuildApiKeys(guildId))[0];

    // Validate that the faction exists in Torn
    if (!apiKey) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("No API key configured. Cannot validate faction.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Fetch and validate faction details from Torn API (with caching)
    const factionDetails = await validateAndFetchFactionDetails(
      factionId,
      apiKey,
    );
    if (!factionDetails) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Invalid Faction")
        .setDescription(
          `Faction **${factionId}** does not exist in Torn. Please check the ID and try again.`,
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Check if this faction is already mapped
    const existingMapping = await db
      .selectFrom(TABLE_NAMES.FACTION_ROLES)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("faction_id", "=", factionId)
      .executeTakeFirst();

    // If not exists, create it with empty roles
    if (!existingMapping) {
      await db
        .insertInto(TABLE_NAMES.FACTION_ROLES)
        .values({
          id: randomUUID(),
          guild_id: guildId,
          faction_id: factionId,
          faction_name: factionDetails.name,
          member_role_ids: JSON.stringify([]),
          leader_role_ids: JSON.stringify([]),
          enabled: 1, // SQLite stores as 0/1
        })
        .execute();

      await logGuildAudit({
        guildId,
        actorId: interaction.user.id,
        action: "faction_added",
        details: {
          factionId,
          factionName: factionDetails.name,
        },
      });

      // Trigger faction list update
      await updateFactionList(guildId, interaction.client);
    }

    // Show faction management page
    const memberRoleIds: string[] =
      typeof existingMapping?.member_role_ids === "string"
        ? JSON.parse(existingMapping.member_role_ids)
        : existingMapping?.member_role_ids || [];
    const leaderRoleIds: string[] =
      typeof existingMapping?.leader_role_ids === "string"
        ? JSON.parse(existingMapping.leader_role_ids)
        : existingMapping?.leader_role_ids || [];
    const enabled = Number(existingMapping?.enabled) !== 0; // SQLite stores as 0/1

    // Build description
    let description = `Configure role assignments for **${factionDetails.name}**.\n\n`;
    description += `**Status:** ${enabled ? "<:Green:1474607376140079104> Enabled" : "<:Red:1474607810368114886> Disabled"}\n\n`;
    description += `**Member Roles** (assigned to ALL faction members):\n`;
    description +=
      memberRoleIds.length > 0
        ? memberRoleIds.map((id: string) => `<@&${id}>`).join(", ")
        : "_None configured_";
    description += `\n\n**Leader Roles** (assigned ONLY to Leaders & Co-leaders):\n`;
    description +=
      leaderRoleIds.length > 0
        ? leaderRoleIds.map((id: string) => `<@&${id}>`).join(", ")
        : "_None configured_";

    const manageEmbed = new EmbedBuilder()
      .setColor(enabled ? 0x22c55e : 0xef4444)
      .setTitle(`Manage Faction: ${factionDetails.name}`)
      .setDescription(description)
      .setFooter({ text: `Faction ID: ${factionId}` });

    // Buttons
    const toggleBtn = new ButtonBuilder()
      .setCustomId(`config_faction_toggle_${factionId}`)
      .setLabel(enabled ? "Disable" : "Enable")
      .setStyle(enabled ? ButtonStyle.Secondary : ButtonStyle.Success);

    const memberRolesBtn = new ButtonBuilder()
      .setCustomId(`config_faction_member_roles_${factionId}`)
      .setLabel("Set Member Roles")
      .setStyle(ButtonStyle.Primary);

    const leaderRolesBtn = new ButtonBuilder()
      .setCustomId(`config_faction_leader_roles_${factionId}`)
      .setLabel("Set Leader Roles")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_verify_settings")
      .setLabel("Back to Verification Settings")
      .setStyle(ButtonStyle.Secondary);

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(toggleBtn);
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      memberRolesBtn,
      leaderRolesBtn,
    );
    const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [manageEmbed],
      components: [row1, row2, row3],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in add faction role modal handler:", errorMsg);
  }
}

export async function handleRemoveFactionRoleModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const factionIdStr =
      interaction.fields.getTextInputValue("faction_id_input");
    const guildId = interaction.guildId;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Unable to determine guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    const factionId = parseInt(factionIdStr, 10);
    if (isNaN(factionId)) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Invalid Faction ID")
        .setDescription("Faction ID must be a valid number.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    try {
      await db
        .deleteFrom(TABLE_NAMES.FACTION_ROLES)
        .where("guild_id", "=", guildId)
        .where("faction_id", "=", factionId)
        .execute();
    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Remove Mapping")
        .setDescription(error instanceof Error ? error.message : String(error));

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "faction_role_mapping_removed",
      details: {
        factionId,
      },
    });

    // Trigger faction list update
    await updateFactionList(guildId, interaction.client);

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Faction Role Mapping Removed")
      .setDescription(`Removed role mapping for faction **${factionId}**`)
      .setFooter({
        text: "Existing users will keep their roles",
      });

    const backBtn = new ButtonBuilder()
      .setCustomId("verify_settings_edit_cancel")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in remove faction role modal handler:", errorMsg);
  }
}

export async function handleFactionRoleSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
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

    const factionId = parseInt(
      interaction.customId.replace("config_faction_role_select_", ""),
      10,
    );

    if (isNaN(factionId)) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Invalid faction ID.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    const roleIds = interaction.values;

    const apiKey = (await getGuildApiKeys(guildId))[0];

    // Fetch faction details
    let factionName = "Unknown";
    if (apiKey) {
      const factionDetails = await validateAndFetchFactionDetails(
        factionId,
        apiKey,
      );
      if (factionDetails) {
        factionName = factionDetails.name;
      }
    }

    // Store all faction details together
    const success = await storeFactionDetails(
      guildId,
      factionId,
      roleIds,
      factionName,
    );

    if (!success) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Save Mapping")
        .setDescription("Could not save faction role mapping.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "faction_role_mapping_saved",
      details: {
        factionId,
        roleIds,
      },
    });

    const rolesMention = roleIds.map((id) => `<@&${id}>`).join(", ");

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Faction Role Mapping Saved")
      .setDescription(
        `Faction **${factionName}** will now be assigned:\n${rolesMention}`,
      )
      .setFooter({
        text: "This will apply to newly verified users",
      });

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_verify_settings")
      .setLabel("Back to Verification Settings")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in faction role select handler:", errorMsg);
  }
}

export async function handleFactionListChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const channelId = interaction.values[0];

    // Update guild config
    await db
      .updateTable(TABLE_NAMES.GUILD_CONFIG)
      .set({
        faction_list_channel_id: channelId,
        faction_list_message_ids: JSON.stringify([]), // Reset message IDs when channel changes
      })
      .where("guild_id", "=", guildId)
      .execute();

    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "faction_list_channel_updated",
      details: {
        channelId,
      },
    });

    // Trigger immediate update
    await updateFactionList(guildId, interaction.client);

    // Refresh settings view
    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (guildConfig) {
      await showVerifySettings(interaction, guildConfig);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in faction list channel select handler:", errorMsg);
  }
}

export async function handleVerifiedRoleSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
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

    const roleId = interaction.values[0];

    try {
      await db
        .updateTable(TABLE_NAMES.GUILD_CONFIG)
        .set({ verified_role_id: roleId })
        .where("guild_id", "=", guildId)
        .execute();
    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Save Verification Role")
        .setDescription(error instanceof Error ? error.message : String(error));

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Verification Role Updated")
      .setDescription(
        `New members will be assigned <@&${roleId}> upon verification.`,
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_verify_settings")
      .setLabel("Back to Verification Settings")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "verified_role_updated",
      details: { role_id: roleId },
    });

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in verified role select handler:", errorMsg);
  }
}

export async function handleNicknameTemplateModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const template = interaction.fields.getTextInputValue(
      "nickname_template_input",
    );
    const guildId = interaction.guildId;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Unable to determine guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    try {
      await db
        .updateTable(TABLE_NAMES.GUILD_CONFIG)
        .set({ nickname_template: template })
        .where("guild_id", "=", guildId)
        .execute();
    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Save Template")
        .setDescription(error instanceof Error ? error.message : String(error));

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "nickname_template_updated",
      details: {
        template,
      },
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Nickname Template Updated")
      .setDescription(`Template: **${template}**`)
      .setFooter({
        text: "Template will be applied to verified user nicknames",
      });

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_verify_settings")
      .setLabel("Back to Verification Settings")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in nickname template modal handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Error")
      .setDescription(errorMsg);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
        components: [],
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

export async function handleConfirmAutoVerifyToggle(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;

    if (!guildId) {
      return;
    }

    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .select(["auto_verify"])
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!guildConfig) {
      return;
    }

    const newValue = !guildConfig.auto_verify;

    try {
      await db
        .updateTable(TABLE_NAMES.GUILD_CONFIG)
        .set({ auto_verify: newValue ? 1 : 0 })
        .where("guild_id", "=", guildId)
        .execute();
    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Update Setting")
        .setDescription(error instanceof Error ? error.message : String(error));

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "auto_verify_toggled",
      details: {
        enabled: newValue,
      },
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Auto Verification Updated")
      .setDescription(
        `Auto verification is now **${newValue ? "enabled" : "disabled"}**`,
      )
      .setFooter({
        text: newValue
          ? "New members will be automatically verified on join"
          : "New members will not be automatically verified",
      });

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_verify_settings")
      .setLabel("Back to Verification Settings")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in confirm auto verify toggle handler:", errorMsg);
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

/**
 * Territory (TT) module handlers - re-exported from territoryHandlers module
 * Enables clean dispatch from index.ts
 */
export async function handleShowTTSettings(
  interaction: ButtonInteraction,
): Promise<void> {
  return territoryHandlers.handleShowTTSettings(interaction);
}

export async function handleTTSettingsEdit(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return territoryHandlers.handleTTSettingsEdit(interaction);
}

export async function handleTTFilteredSettingsEdit(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return territoryHandlers.handleTTFilteredSettingsEdit(interaction);
}

export async function handleTTNotificationTypeSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return territoryHandlers.handleTTNotificationTypeSelect(interaction);
}

export async function handleTTFullChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return territoryHandlers.handleTTFullChannelSelect(interaction);
}

export async function handleTTFilteredChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return territoryHandlers.handleTTFilteredChannelSelect(interaction);
}

export async function handleTTFullChannelClear(
  interaction: ButtonInteraction,
): Promise<void> {
  return territoryHandlers.handleTTFullChannelClear(interaction);
}

export async function handleTTFilteredChannelClear(
  interaction: ButtonInteraction,
): Promise<void> {
  return territoryHandlers.handleTTFilteredChannelClear(interaction);
}

export async function handleTTEditTerritoriesModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return territoryHandlers.handleTTEditTerritoriesModalSubmit(interaction);
}

export async function handleTTEditFactionsModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return territoryHandlers.handleTTEditFactionsModalSubmit(interaction);
}

export async function handleTTWarTrackPage(
  interaction: ButtonInteraction,
): Promise<void> {
  return territoryHandlers.handleTTWarTrackPage(interaction);
}

export async function handleTTWarTrackSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return territoryHandlers.handleTTWarTrackSelect(interaction);
}

export async function handleTTWarTrackBack(
  interaction: ButtonInteraction,
): Promise<void> {
  return territoryHandlers.handleTTWarTrackBack(interaction);
}

export async function handleTTWarTrackChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return territoryHandlers.handleTTWarTrackChannelSelect(interaction);
}

export async function handleTTWarTrackChannelClear(
  interaction: ButtonInteraction,
): Promise<void> {
  return territoryHandlers.handleTTWarTrackChannelClear(interaction);
}

export async function handleTTWarTrackEnemySideSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return territoryHandlers.handleTTWarTrackEnemySideSelect(interaction);
}

export async function handleTTWarTrackAwayFilterButton(
  interaction: ButtonInteraction,
): Promise<void> {
  return territoryHandlers.handleTTWarTrackAwayFilterButton(interaction);
}

export async function handleTTWarTrackAwayFilterSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return territoryHandlers.handleTTWarTrackAwayFilterSubmit(interaction);
}

// Faction Role Management Handlers
export async function handleFactionManageSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const factionId = parseInt(
      interaction.values[0].replace("faction_manage_", ""),
      10,
    );

    if (isNaN(factionId)) {
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const apiKey = (await getGuildApiKeys(guildId))[0];

    await showFactionManagePage(interaction, factionId, apiKey);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in faction manage select handler:", errorMsg);
  }
}

export async function handleFactionManageBack(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const apiKey = (await getGuildApiKeys(guildId))[0];

    await showFactionRoleMenu(interaction, guildId, apiKey);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in faction manage back handler:", errorMsg);
  }
}

export async function handleFactionToggle(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const factionId = parseInt(
      interaction.customId.replace("config_faction_toggle_", ""),
      10,
    );

    if (isNaN(factionId)) {
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    // Get current mapping
    const currentMapping = await db
      .selectFrom(TABLE_NAMES.FACTION_ROLES)
      .select(["enabled"])
      .where("guild_id", "=", guildId)
      .where("faction_id", "=", factionId)
      .executeTakeFirst();

    if (!currentMapping) return;

    const newEnabled = Number(currentMapping.enabled) === 0; // Toggle (SQLite 0/1)

    // Update in database
    try {
      await db
        .updateTable(TABLE_NAMES.FACTION_ROLES)
        .set({ enabled: newEnabled ? 1 : 0 })
        .where("guild_id", "=", guildId)
        .where("faction_id", "=", factionId)
        .execute();
    } catch (error) {
      console.error("Error toggling faction:", error);
      return;
    }

    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: newEnabled ? "faction_enabled" : "faction_disabled",
      details: { factionId },
    });

    // Trigger faction list update
    await updateFactionList(guildId, interaction.client);

    const apiKey = (await getGuildApiKeys(guildId))[0];

    await showFactionManagePage(interaction, factionId, apiKey);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in faction toggle handler:", errorMsg);
  }
}

export async function handleFactionMemberRolesButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const factionId = parseInt(
      interaction.customId.replace("config_faction_member_roles_", ""),
      10,
    );

    if (isNaN(factionId)) {
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    // Fetch faction name
    const factionMapping = await db
      .selectFrom(TABLE_NAMES.FACTION_ROLES)
      .select(["faction_name"])
      .where("guild_id", "=", guildId)
      .where("faction_id", "=", factionId)
      .executeTakeFirst();

    const factionName = factionMapping?.faction_name || `Faction ${factionId}`;

    const selectEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Select Member Roles")
      .setDescription(
        `Select one or more roles to assign to **all members** of **${factionName}** (ID: ${factionId}).`,
      );

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`config_faction_member_roles_select_${factionId}`)
      .setPlaceholder("Select roles for all faction members")
      .setMinValues(0)
      .setMaxValues(10);

    const row = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      roleSelect,
    );

    await interaction.editReply({
      embeds: [selectEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in faction member roles button handler:", errorMsg);
  }
}

export async function handleFactionLeaderRolesButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const factionId = parseInt(
      interaction.customId.replace("config_faction_leader_roles_", ""),
      10,
    );

    if (isNaN(factionId)) {
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    // Fetch faction name
    const factionMapping = await db
      .selectFrom(TABLE_NAMES.FACTION_ROLES)
      .select(["faction_name"])
      .where("guild_id", "=", guildId)
      .where("faction_id", "=", factionId)
      .executeTakeFirst();

    const factionName = factionMapping?.faction_name || `Faction ${factionId}`;

    const selectEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Select Leader Roles")
      .setDescription(
        `Select one or more roles to assign **only to Leaders and Co-leaders** of **${factionName}** (ID: ${factionId}).`,
      );

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`config_faction_leader_roles_select_${factionId}`)
      .setPlaceholder("Select roles for faction leaders")
      .setMinValues(0)
      .setMaxValues(10);

    const row = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      roleSelect,
    );

    await interaction.editReply({
      embeds: [selectEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in faction leader roles button handler:", errorMsg);
  }
}

export async function handleFactionMemberRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const factionId = parseInt(
      interaction.customId.replace("config_faction_member_roles_select_", ""),
      10,
    );

    if (isNaN(factionId)) {
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const roleIds = interaction.values;

    // Update in database
    try {
      await db
        .updateTable(TABLE_NAMES.FACTION_ROLES)
        .set({ member_role_ids: JSON.stringify(roleIds) })
        .where("guild_id", "=", guildId)
        .where("faction_id", "=", factionId)
        .execute();
    } catch (error) {
      console.error("Error updating member roles:", error);
      return;
    }

    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "faction_member_roles_updated",
      details: { factionId, roleIds },
    });

    const apiKey = (await getGuildApiKeys(guildId))[0];

    await showFactionManagePage(interaction, factionId, apiKey);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in faction member roles select handler:", errorMsg);
  }
}

export async function handleFactionLeaderRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const factionId = parseInt(
      interaction.customId.replace("config_faction_leader_roles_select_", ""),
      10,
    );

    if (isNaN(factionId)) {
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const roleIds = interaction.values;

    // Update in database
    try {
      await db
        .updateTable(TABLE_NAMES.FACTION_ROLES)
        .set({ leader_role_ids: JSON.stringify(roleIds) })
        .where("guild_id", "=", guildId)
        .where("faction_id", "=", factionId)
        .execute();
    } catch (error) {
      console.error("Error updating leader roles:", error);
      return;
    }

    await logGuildAudit({
      guildId,
      actorId: interaction.user.id,
      action: "faction_leader_roles_updated",
      details: { factionId, roleIds },
    });

    const apiKey = (await getGuildApiKeys(guildId))[0];

    await showFactionManagePage(interaction, factionId, apiKey);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in faction leader roles select handler:", errorMsg);
  }
}

/**
 * Reaction Roles module handlers - re-exported from reactionRolesHandlers module
 * Enables clean dispatch from index.ts
 */
export async function handleShowReactionRolesSettings(
  interaction: ButtonInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  return reactionRolesHandlers.handleShowReactionRolesSettings(
    interaction,
    isAlreadyDeferred,
  );
}

export async function handleEditReactionRolesAllowed(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleEditAllowedRoles(interaction);
}

export async function handleAllowedRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleAllowedRolesSelect(interaction);
}

export async function handleCreateReactionRoleMapping(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleAddMapping(interaction);
}

export async function handleCreateReactionRoleMappingModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleMappingEmojiModal(interaction);
}

export async function handleViewReactionRoleMappings(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleViewMessages(interaction);
}

export async function handleSelectDeleteReactionRoleMapping(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleDeleteMessage(interaction);
}

export async function handleDeleteReactionRoleMapping(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleDeleteSelect(interaction);
}

export async function handleCreateReactionRoleMessage(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleCreateMessage(interaction);
}

export async function handleViewReactionRoleMessages(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleViewMessages(interaction);
}

export async function handleEditReactionRoleMappings(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleEditMappings(interaction);
}

export async function handleEditReactionRoleMappingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleEditMappingsSelect(interaction);
}

export async function handleEditReactionRoleAddMapping(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleEditAddMapping(interaction);
}

export async function handleEditReactionRoleRemoveMapping(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleEditRemoveMapping(interaction);
}

export async function handleEditReactionRoleRemoveMappingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleEditRemoveMappingSelect(interaction);
}

export async function handleEditReactionRoleMappingsReturn(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleEditMappingsReturn(interaction);
}

export async function handleDeleteReactionRoleMessage(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleDeleteMessage(interaction);
}

export async function handleCancelReactionRoleCreate(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleCancelCreate(interaction);
}

export async function handleAddReactionRoleMapping(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleAddMapping(interaction);
}

export async function handlePostReactionRoleMessage(
  interaction: ButtonInteraction,
): Promise<void> {
  return reactionRolesHandlers.handlePostMessage(interaction);
}

export async function handleCreateReactionRoleEmbedModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleCreateEmbedModal(interaction);
}

export async function handleChannelSelectForReactionRoles(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleChannelSelect(interaction);
}

export async function handleMappingEmojiModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleMappingEmojiModal(interaction);
}

export async function handleMappingRoleSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  return reactionRolesHandlers.handleMappingRoleSelect(interaction);
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
