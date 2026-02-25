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
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";
import { encrypt, decrypt } from "../../../lib/encryption.js";
import { getAuthorizedDiscordUserId } from "../../../lib/auth.js";
import {
  fetchAndStoreFactionNames,
  validateAndFetchFactionDetails,
  storeFactionDetails,
} from "../../../lib/faction-utils.js";
import { logGuildError, logGuildSuccess } from "../../../lib/guild-logger.js";
import * as territoryHandlers from "./handlers/territories.js";

interface ApiKeyEntry {
  key: string; // encrypted
  fingerprint: string; // last 4 characters for display
  isActive: boolean;
  createdAt: string;
}

function buildConfigViewMenuRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel("Admin Settings")
      .setValue("admin")
      .setDescription("Manage administrative settings"),
    new StringSelectMenuOptionBuilder()
      .setLabel("Verification Settings")
      .setValue("verify")
      .setDescription("Manage verification settings"),
    new StringSelectMenuOptionBuilder()
      .setLabel("Territories Settings")
      .setValue("territories")
      .setDescription("Manage TT notifications and filters"),
  ];

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
  supabase: SupabaseClient,
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
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

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
    const adminRoleIds: string[] = guildConfig.admin_role_ids || [];
    const botOwnerId = getAuthorizedDiscordUserId();
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
    const row = buildConfigViewMenuRow();

    const menuEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Guild Configuration")
      .setDescription("Select a settings section to manage")
      .setFooter({
        text: isAdminGuild
          ? "Admin Guild - Full control available"
          : "Contact Blasted to modify",
      });

    await interaction.editReply({
      embeds: [menuEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in config command:", errorMsg);
    if (interaction.guildId) {
      await logGuildError(
        interaction.guildId,
        interaction.client,
        supabase,
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
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const selectedView = interaction.values[0];

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

    // Get guild config
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

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

    if (selectedView === "admin") {
      await showAdminSettings(interaction, guildConfig);
    } else if (selectedView === "verify") {
      await showVerifySettings(interaction, supabase, guildConfig);
    } else if (selectedView === "territories") {
      await territoryHandlers.handleShowTTSettings(interaction, supabase);
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

async function showAdminSettings(
  interaction: StringSelectMenuInteraction,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  guildConfig: any,
): Promise<void> {
  // Parse API keys from config
  const apiKeys: ApiKeyEntry[] = guildConfig.api_keys || [];
  const _hasApiKey = apiKeys.length > 0;

  let apiKeyDisplay = "No keys configured";
  if (apiKeys.length > 0) {
    apiKeyDisplay = apiKeys
      .map((k: ApiKeyEntry) => {
        const status = k.isActive
          ? "<:Green:1474607376140079104>"
          : "<:Red:1474607810368114886>";
        return `${status} ...${k.fingerprint}`;
      })
      .join("\n");
  }

  const logChannelDisplay = guildConfig.log_channel_id
    ? `<#${guildConfig.log_channel_id}>`
    : "Not configured";

  // Format admin roles display
  const adminRoleIds: string[] = guildConfig.admin_role_ids || [];
  let adminRolesDisplay = "Not configured (anyone can use config)";
  if (adminRoleIds.length > 0) {
    adminRolesDisplay = adminRoleIds
      .map((roleId) => `<@&${roleId}>`)
      .join(", ");
  }

  const adminEmbed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("Admin Settings")
    .addFields(
      {
        name: "API Keys",
        value: apiKeyDisplay,
        inline: false,
      },
      {
        name: "Log Channel",
        value: logChannelDisplay,
        inline: false,
      },
      {
        name: "Admin Roles",
        value: adminRolesDisplay,
        inline: false,
      },
    )
    .setFooter({
      text: "API keys are encrypted and stored securely",
    });

  const editKeysBtn = new ButtonBuilder()
    .setCustomId("config_edit_api_keys")
    .setLabel("Manage API Keys")
    .setStyle(ButtonStyle.Primary);

  const editLogChannelBtn = new ButtonBuilder()
    .setCustomId("config_edit_log_channel")
    .setLabel("Edit Log Channel")
    .setStyle(ButtonStyle.Primary);

  const editAdminRolesBtn = new ButtonBuilder()
    .setCustomId("config_edit_admin_roles")
    .setLabel("Manage Admin Roles")
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId("config_back_to_menu")
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    editKeysBtn,
    editLogChannelBtn,
    editAdminRolesBtn,
    backBtn,
  );

  await interaction.editReply({
    embeds: [adminEmbed],
    components: [row],
  });
}

async function showVerifySettings(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  guildConfig: any,
): Promise<void> {
  // Fetch faction role mappings
  const { data: factionRoles } = await supabase
    .from(TABLE_NAMES.FACTION_ROLES)
    .select("*")
    .eq("guild_id", interaction.guildId)
    .order("faction_id", { ascending: true });

  const apiKeys: ApiKeyEntry[] = guildConfig.api_keys || [];
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
    );

  // Only show sync interval if auto verification is enabled
  if (guildConfig.auto_verify) {
    verifyEmbed.addFields({
      name: "Sync Interval",
      value: `${guildConfig.sync_interval_seconds || 3600} seconds (${Math.round((guildConfig.sync_interval_seconds || 3600) / 60)} min)`,
      inline: false,
    });
  }

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
  ];

  // Only show sync interval option if auto verification is enabled
  if (guildConfig.auto_verify) {
    settingOptions.push(
      new StringSelectMenuOptionBuilder()
        .setLabel("Sync Interval")
        .setValue("edit_sync")
        .setDescription("How often to resync data"),
    );
  }

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
  _supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const adminGuildId = process.env.ADMIN_GUILD_ID;
    const isAdminGuild = guildId === adminGuildId;

    const row = buildConfigViewMenuRow();

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
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

    if (!guildConfig) return;

    // Create a mock StringSelectMenuInteraction to reuse showVerifySettings
    // Since we can't directly pass ButtonInteraction to showVerifySettings,
    // we'll inline the display logic here
    const { data: factionRoles } = await supabase
      .from(TABLE_NAMES.FACTION_ROLES)
      .select("*")
      .eq("guild_id", guildId)
      .order("faction_id", { ascending: true });

    const apiKeys: ApiKeyEntry[] = guildConfig.api_keys || [];
    const hasApiKey = apiKeys.length > 0;

    let factionRolesDisplay = "None configured";
    if (factionRoles && factionRoles.length > 0) {
      // Fetch faction names for display (if API key available)
      const missingNames = factionRoles.filter((fr) => !fr.faction_name);
      if (missingNames.length > 0) {
        const activeKey = apiKeys.find((k) => k.isActive);
        if (activeKey) {
          try {
            const apiKey = decrypt(activeKey.key);
            const factionIds = missingNames.map((fr) => fr.faction_id);
            await fetchAndStoreFactionNames(factionIds, supabase, apiKey);
          } catch (error) {
            console.error("Error decrypting API key:", error);
          }
        }
      }

      factionRolesDisplay = factionRoles
        .map((fr) => {
          const factionName = fr.faction_name || `Faction ${fr.faction_id}`;
          const rolesMention = fr.role_ids
            .map((roleId: string) => `<@&${roleId}>`)
            .join(", ");
          return `▸ ${factionName}: ${rolesMention}`;
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

    // Only show sync interval if auto verification is enabled
    if (guildConfig.auto_verify) {
      verifyEmbed.addFields({
        name: "Sync Interval",
        value: `${guildConfig.sync_interval_seconds || 3600} seconds (${Math.round((guildConfig.sync_interval_seconds || 3600) / 60)} min)`,
        inline: false,
      });
    }

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

    // Only show sync interval option if auto verification is enabled
    if (guildConfig.auto_verify) {
      settingOptions.push(
        new StringSelectMenuOptionBuilder()
          .setLabel("Sync Interval")
          .setValue("edit_sync")
          .setDescription("How often to resync data"),
      );
    }

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

export async function handleBackToAdminSettings(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

    if (!guildConfig) return;

    const apiKeys: ApiKeyEntry[] = guildConfig.api_keys || [];

    let apiKeyDisplay = "No keys configured";
    if (apiKeys.length > 0) {
      apiKeyDisplay = apiKeys
        .map((k: ApiKeyEntry) => {
          const status = k.isActive
            ? "<:Green:1474607376140079104>"
            : "<:Red:1474607810368114886>";
          return `${status} ...${k.fingerprint}`;
        })
        .join("\n");
    }

    const logChannelDisplay = guildConfig.log_channel_id
      ? `<#${guildConfig.log_channel_id}>`
      : "Not configured";

    // Format admin roles display
    const adminRoleIds: string[] = guildConfig.admin_role_ids || [];
    let adminRolesDisplay = "Not configured (anyone can use config)";
    if (adminRoleIds.length > 0) {
      adminRolesDisplay = adminRoleIds
        .map((roleId) => `<@&${roleId}>`)
        .join(", ");
    }

    const adminEmbed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Admin Settings")
      .addFields(
        {
          name: "API Keys",
          value: apiKeyDisplay,
          inline: false,
        },
        {
          name: "Log Channel",
          value: logChannelDisplay,
          inline: false,
        },
        {
          name: "Admin Roles",
          value: adminRolesDisplay,
          inline: false,
        },
      )
      .setFooter({
        text: "API keys are encrypted and stored securely",
      });

    const editKeysBtn = new ButtonBuilder()
      .setCustomId("config_edit_api_keys")
      .setLabel("Manage API Keys")
      .setStyle(ButtonStyle.Primary);

    const editLogChannelBtn = new ButtonBuilder()
      .setCustomId("config_edit_log_channel")
      .setLabel("Edit Log Channel")
      .setStyle(ButtonStyle.Primary);

    const editAdminRolesBtn = new ButtonBuilder()
      .setCustomId("config_edit_admin_roles")
      .setLabel("Manage Admin Roles")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_to_menu")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      editKeysBtn,
      editLogChannelBtn,
      editAdminRolesBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [adminEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in back to admin settings handler:", errorMsg);
  }
}

// Handler for verify settings edit menu
export async function handleVerifySettingsEdit(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
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
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

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
    let apiKey: string | undefined;
    const apiKeys: ApiKeyEntry[] = guildConfig.api_keys || [];
    const activeKey = apiKeys.find((k) => k.isActive);
    if (activeKey) {
      try {
        apiKey = decrypt(activeKey.key);
      } catch (error) {
        console.error("Error decrypting API key:", error);
      }
    }

    if (selectedSetting === "edit_auto_verify") {
      await interaction.deferUpdate();
      // Show confirmation before toggling
      const currentStatus = guildConfig.auto_verify;
      const newStatus = !currentStatus;

      const confirmEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Confirm Change")
        .setDescription(
          `Turn auto-verification **${newStatus ? "on" : "off"}**?\n\n${newStatus ? "New members will be automatically verified on join and during sync intervals" : "Members will need to manually run /verify"}`,
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
    } else if (selectedSetting === "edit_sync") {
      // Show modal for sync interval
      const modal = new ModalBuilder()
        .setCustomId("config_sync_interval_modal")
        .setTitle("Edit Sync Interval");

      const intervalInput = new TextInputBuilder()
        .setCustomId("sync_interval_input")
        .setLabel("Sync Interval (seconds)")
        .setPlaceholder("e.g., 3600 for 1 hour")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(guildConfig.sync_interval_seconds || 3600));

      const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
        intervalInput,
      );
      modal.addComponents(row);

      await interaction.showModal(modal);
    } else if (selectedSetting === "edit_faction") {
      await interaction.deferUpdate();
      // Show faction role management
      await showFactionRoleMenu(interaction, supabase, guildId, apiKey);
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
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
  guildId: string,
  apiKey?: string,
): Promise<void> {
  const { data: factionRoles } = await supabase
    .from(TABLE_NAMES.FACTION_ROLES)
    .select("*")
    .eq("guild_id", guildId)
    .order("faction_id", { ascending: true });

  let factionRolesDisplay = "None configured";
  if (factionRoles && factionRoles.length > 0) {
    // Use stored faction names, fetching missing ones if API key available
    const missingNames = factionRoles.filter((fr) => !fr.faction_name);
    if (missingNames.length > 0 && apiKey) {
      const factionIds = missingNames.map((fr) => fr.faction_id);
      await fetchAndStoreFactionNames(factionIds, supabase, apiKey);
    }

    factionRolesDisplay = factionRoles
      .map((fr) => {
        const factionName = fr.faction_name || `Faction ${fr.faction_id}`;
        const rolesMention = fr.role_ids
          .map((roleId: string) => `<@&${roleId}>`)
          .join(", ");
        return `▸ ${factionName}: ${rolesMention}`;
      })
      .join("\n");
  }

  const factionEmbed = new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle("Faction Role Management")
    .addFields({
      name: "Current Mappings",
      value: factionRolesDisplay,
      inline: false,
    });

  const addBtn = new ButtonBuilder()
    .setCustomId("config_add_faction_role")
    .setLabel("Add")
    .setStyle(ButtonStyle.Success);

  const removeBtn = new ButtonBuilder()
    .setCustomId("config_remove_faction_role")
    .setLabel("Remove")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!factionRoles || factionRoles.length === 0);

  const backBtn = new ButtonBuilder()
    .setCustomId("verify_settings_edit_cancel")
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    addBtn,
    removeBtn,
    backBtn,
  );

  await interaction.editReply({
    embeds: [factionEmbed],
    components: [row],
  });
}

// Cancel handler for verify settings submenu
export async function handleVerifySettingsEditCancel(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
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

    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await showVerifySettings(interaction as any, supabase, guildConfig);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in cancel handler:", errorMsg);
  }
}

// Handler for API key management
export async function handleEditApiKeysButton(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
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

    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

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

    const apiKeysView = buildApiKeysView(guildConfig);

    await interaction.editReply(apiKeysView);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in edit API keys handler:", errorMsg);
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

// Handler for adding new API key
export async function handleAddApiKeyButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const messageId = interaction.message?.id;
    const modalId = messageId
      ? `config_add_api_key_modal:${messageId}`
      : "config_add_api_key_modal";
    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle("Add New API Key");

    const apiKeyInput = new TextInputBuilder()
      .setCustomId("new_api_key_input")
      .setLabel("Torn API Key")
      .setPlaceholder("Enter your 16-character Torn API key")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(16)
      .setMinLength(16);

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
      apiKeyInput,
    );
    modal.addComponents(row);

    await interaction.showModal(modal);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in add API key button handler:", errorMsg);
  }
}

// Handler for adding API key modal submission
export async function handleAddApiKeyModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const apiKey = interaction.fields.getTextInputValue("new_api_key_input");
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

    // Get current keys
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("api_keys")
      .eq("guild_id", guildId)
      .single();

    const apiKeys: ApiKeyEntry[] = guildConfig?.api_keys || [];

    if (apiKeys.length >= 5) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Maximum of 5 API keys per guild");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Encrypt and add new key
    const encryptedKey = encrypt(apiKey);
    const fingerprint = apiKey.slice(-4);
    const newKeyEntry: ApiKeyEntry = {
      key: encryptedKey,
      fingerprint,
      isActive: apiKeys.length === 0, // First key is automatically active
      createdAt: new Date().toISOString(),
    };

    const updatedKeys = [...apiKeys, newKeyEntry];

    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ api_keys: updatedKeys })
      .eq("guild_id", guildId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Add Key")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    await logGuildAudit(supabase, {
      guildId,
      actorId: interaction.user.id,
      action: "api_key_added",
      details: {
        fingerprint,
        isActive: newKeyEntry.isActive,
        totalKeys: updatedKeys.length,
      },
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("API Key Added")
      .setDescription(
        `New key added: **...${fingerprint}**\n\n${newKeyEntry.isActive ? "This key is now active" : "This key is inactive. Use Rotate to activate it"}`,
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_admin_settings")
      .setLabel("Back to Admin Settings")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });

    const modalIdParts = interaction.customId.split(":");
    const messageId = modalIdParts.length > 1 ? modalIdParts[1] : null;
    if (messageId && interaction.channel) {
      try {
        const message = await interaction.channel.messages.fetch(messageId);
        if (message) {
          const refreshedConfig = await supabase
            .from(TABLE_NAMES.GUILD_CONFIG)
            .select("api_keys")
            .eq("guild_id", guildId)
            .single();

          if (refreshedConfig.data) {
            await message.edit(buildApiKeysView(refreshedConfig.data));
          }
        }
      } catch (error) {
        const errorCode =
          typeof error === "object" && error !== null && "code" in error
            ? (error as { code?: number }).code
            : undefined;

        if (errorCode !== 10008) {
          console.warn("Failed to refresh API key view:", error);
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in add API key modal handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}

function buildApiKeysView(guildConfig: { api_keys?: ApiKeyEntry[] }): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const apiKeys: ApiKeyEntry[] = guildConfig.api_keys || [];

  let keysDisplay = "No keys configured";
  if (apiKeys.length > 0) {
    keysDisplay = apiKeys
      .map((k: ApiKeyEntry, idx: number) => {
        const status = k.isActive
          ? "<:Green:1474607376140079104>"
          : "<:Red:1474607810368114886>";
        return `${idx + 1}. ${status} ...${k.fingerprint} (${new Date(k.createdAt).toLocaleDateString()})`;
      })
      .join("\n");
  }

  const keysEmbed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("API Key Management")
    .addFields({
      name: `Keys (${apiKeys.length}/5)`,
      value: keysDisplay,
      inline: false,
    })
    .setFooter({
      text: "Manage API keys for verification. Green = active, Red = inactive",
    });

  const addBtn = new ButtonBuilder()
    .setCustomId("config_add_api_key")
    .setLabel("Add New Key")
    .setStyle(ButtonStyle.Success)
    .setDisabled(apiKeys.length >= 5);

  const rotateBtn = new ButtonBuilder()
    .setCustomId("config_rotate_api_key")
    .setLabel("Rotate Active Key")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(apiKeys.length < 2);

  const removeBtn = new ButtonBuilder()
    .setCustomId("config_remove_api_key_menu")
    .setLabel("Remove Key")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(apiKeys.length === 0);

  const backBtn = new ButtonBuilder()
    .setCustomId("config_back_to_menu")
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    addBtn,
    rotateBtn,
    removeBtn,
    backBtn,
  );

  return { embeds: [keysEmbed], components: [row] };
}

// Handler for rotating API key
export async function handleRotateApiKeyButton(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
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

    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("api_keys")
      .eq("guild_id", guildId)
      .single();

    let apiKeys: ApiKeyEntry[] = guildConfig?.api_keys || [];

    if (apiKeys.length < 2) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("Need at least 2 keys to rotate");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Find current active key and next inactive key
    const currentActiveIdx = apiKeys.findIndex((k) => k.isActive);
    const nextInactiveIdx = apiKeys.findIndex(
      (k, idx) => !k.isActive && idx !== currentActiveIdx,
    );

    if (nextInactiveIdx === -1) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("No inactive keys available to rotate to");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    const fromFingerprint = apiKeys[currentActiveIdx].fingerprint;
    const toFingerprint = apiKeys[nextInactiveIdx].fingerprint;

    // Rotate: deactivate current, activate next
    apiKeys[currentActiveIdx].isActive = false;
    apiKeys[nextInactiveIdx].isActive = true;

    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ api_keys: apiKeys })
      .eq("guild_id", guildId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Rotate Key")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    await logGuildAudit(supabase, {
      guildId,
      actorId: interaction.user.id,
      action: "api_key_rotated",
      details: {
        from: fromFingerprint,
        to: toFingerprint,
      },
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("API Key Rotated")
      .setDescription(
        `Switched from ...${fromFingerprint} to ...${toFingerprint}`,
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_admin_settings")
      .setLabel("Back to Admin Settings")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in rotate API key handler:", errorMsg);
  }
}

// Handler for removing API key
export async function handleRemoveApiKeyMenuButton(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;

    if (!guildId) {
      return;
    }

    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("api_keys")
      .eq("guild_id", guildId)
      .single();

    const apiKeys: ApiKeyEntry[] = guildConfig?.api_keys || [];

    if (apiKeys.length === 0) {
      return;
    }

    const options = apiKeys.map((k, idx) => {
      const status = k.isActive ? "🟢" : "🔴";
      return new StringSelectMenuOptionBuilder()
        .setLabel(`${status} ...${k.fingerprint}`)
        .setValue(`remove_key_${idx}`);
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("config_remove_api_key_select")
      .setPlaceholder("Select key to remove...")
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu,
    );

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Remove API Key")
      .setDescription("Select which key to remove:");

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in remove API key menu handler:", errorMsg);
  }
}

// Handler for removing API key selection
export async function handleRemoveApiKeySelect(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const keyIndexStr = interaction.values[0].replace("remove_key_", "");
    const keyIndex = parseInt(keyIndexStr, 10);

    if (!guildId) {
      return;
    }

    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("api_keys")
      .eq("guild_id", guildId)
      .single();

    let apiKeys: ApiKeyEntry[] = guildConfig?.api_keys || [];

    if (keyIndex < 0 || keyIndex >= apiKeys.length) {
      return;
    }

    const removedKey = apiKeys[keyIndex];
    const removedFingerprint = removedKey.fingerprint;
    const removedWasActive = removedKey.isActive;

    if (removedKey.isActive && apiKeys.length > 1) {
      // If removing active key, make the next key active
      apiKeys.splice(keyIndex, 1);
      if (apiKeys.length > 0) {
        apiKeys[0].isActive = true;
      }
    } else {
      apiKeys.splice(keyIndex, 1);
    }

    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ api_keys: apiKeys })
      .eq("guild_id", guildId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Remove Key")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    await logGuildAudit(supabase, {
      guildId,
      actorId: interaction.user.id,
      action: "api_key_removed",
      details: {
        fingerprint: removedFingerprint,
        wasActive: removedWasActive,
        totalKeys: apiKeys.length,
      },
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("API Key Removed")
      .setDescription(`Removed key: ...${removedFingerprint}`);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_admin_settings")
      .setLabel("Back to Admin Settings")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in remove API key select handler:", errorMsg);
  }
}

// Old handlers for backwards compatibility - still need faction role and sync interval handlers
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
  supabase: SupabaseClient,
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

    // Get guild config to extract API key for faction validation
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("api_keys")
      .eq("guild_id", guildId)
      .single();

    // Get active API key if available
    let apiKey: string | undefined;
    const apiKeys: ApiKeyEntry[] = guildConfig?.api_keys || [];
    const activeKey = apiKeys.find((k) => k.isActive);
    if (activeKey) {
      try {
        apiKey = decrypt(activeKey.key);
      } catch (error) {
        console.error("Error decrypting API key:", error);
      }
    }

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
      supabase,
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

    // Check if this faction is already mapped to get existing roles
    const { data: existingMapping } = await supabase
      .from(TABLE_NAMES.FACTION_ROLES)
      .select("role_ids")
      .eq("guild_id", guildId)
      .eq("faction_id", factionId)
      .maybeSingle();

    const selectEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Select Roles")
      .setDescription(
        `Select one or more roles to assign to members of **${factionDetails.name}**`,
      );

    if (existingMapping && existingMapping.role_ids.length > 0) {
      const currentRoles = existingMapping.role_ids
        .map((roleId: string) => `<@&${roleId}>`)
        .join(", ");
      selectEmbed.addFields({
        name: "Current Roles",
        value: currentRoles,
        inline: false,
      });
    }

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`config_faction_role_select_${factionId}`)
      .setPlaceholder("Select roles for this faction")
      .setMinValues(1)
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
    console.error("Error in add faction role modal handler:", errorMsg);
  }
}

export async function handleRemoveFactionRoleModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
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

    const { error } = await supabase
      .from(TABLE_NAMES.FACTION_ROLES)
      .delete()
      .eq("guild_id", guildId)
      .eq("faction_id", factionId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Remove Mapping")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    await logGuildAudit(supabase, {
      guildId,
      actorId: interaction.user.id,
      action: "faction_role_mapping_removed",
      details: {
        factionId,
      },
    });

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
  supabase: SupabaseClient,
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

    // Get API key to fetch faction name
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("api_keys")
      .eq("guild_id", guildId)
      .single();

    let apiKey: string | undefined;
    const apiKeys: ApiKeyEntry[] = guildConfig?.api_keys || [];
    const activeKey = apiKeys.find((k) => k.isActive);
    if (activeKey) {
      try {
        apiKey = decrypt(activeKey.key);
      } catch (error) {
        console.error("Error decrypting API key:", error);
      }
    }

    // Fetch faction details
    let factionName = "Unknown";
    if (apiKey) {
      const factionDetails = await validateAndFetchFactionDetails(
        factionId,
        apiKey,
        supabase,
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
      supabase,
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

    await logGuildAudit(supabase, {
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

export async function handleVerifiedRoleSelect(
  interaction: RoleSelectMenuInteraction,
  supabase: SupabaseClient,
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

    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ verified_role_id: roleId })
      .eq("guild_id", guildId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Save Verification Role")
        .setDescription(error.message);

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

    await logGuildAudit(supabase, {
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
  supabase: SupabaseClient,
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

    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ nickname_template: template })
      .eq("guild_id", guildId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Save Template")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    await logGuildAudit(supabase, {
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
        ephemeral: true,
      });
    }
  }
}

export async function handleSyncIntervalModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guildId;
    if (!guildId) {
      throw new Error("Guild ID not found");
    }

    const intervalStr = interaction.fields.getTextInputValue(
      "sync_interval_input",
    );
    const interval = parseInt(intervalStr, 10);

    if (isNaN(interval) || interval < 60 || interval > 86400) {
      throw new Error(
        "Sync interval must be between 60 and 86400 seconds (1 minute to 24 hours)",
      );
    }

    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ sync_interval_seconds: interval })
      .eq("guild_id", guildId);

    if (error) {
      throw error;
    }

    const nextSync = new Date(Date.now() + interval * 1000);
    await supabase.from(TABLE_NAMES.GUILD_SYNC_JOBS).upsert(
      {
        guild_id: guildId,
        next_sync_at: nextSync.toISOString(),
      },
      { onConflict: "guild_id" },
    );

    await logGuildAudit(supabase, {
      guildId,
      actorId: interaction.user.id,
      action: "sync_interval_updated",
      details: {
        intervalSeconds: interval,
      },
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("Sync Interval Updated")
      .setDescription(
        `Guild sync interval set to **${interval} seconds** (${Math.round(interval / 60)} minutes)`,
      );

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
    console.error("Error in sync interval modal handler:", errorMsg);
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
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;

    if (!guildId) {
      return;
    }

    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("auto_verify")
      .eq("guild_id", guildId)
      .single();

    if (!guildConfig) {
      return;
    }

    const newValue = !guildConfig.auto_verify;

    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ auto_verify: newValue })
      .eq("guild_id", guildId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Update Setting")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    await logGuildAudit(supabase, {
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
          ? "New members will be automatically verified on join and during sync intervals"
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
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("log_channel_id")
      .eq("guild_id", guildId)
      .single();

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
  supabase: SupabaseClient,
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
    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ log_channel_id: selectedChannel.id })
      .eq("guild_id", guildId);

    if (error) {
      await logGuildError(
        guildId,
        interaction.client,
        supabase,
        "Log Channel Update Failed",
        error.message,
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
    await logGuildAudit(supabase, {
      guildId,
      actorId: interaction.user.id,
      action: "log_channel_updated",
      details: { log_channel_id: selectedChannel.id },
    });

    await logGuildSuccess(
      guildId,
      interaction.client,
      supabase,
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
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    // Clear log channel
    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ log_channel_id: null })
      .eq("guild_id", guildId);

    if (error) {
      await logGuildError(
        guildId,
        interaction.client,
        supabase,
        "Log Channel Clear Failed",
        error.message,
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
    await logGuildAudit(supabase, {
      guildId,
      actorId: interaction.user.id,
      action: "log_channel_cleared",
    });

    await logGuildSuccess(
      guildId,
      interaction.client,
      supabase,
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
  supabase: SupabaseClient,
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
    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({
        admin_role_ids: selectedRoleIds,
      })
      .eq("guild_id", guildId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Failed to Update Admin Roles")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Log this action
    await logGuildAudit(supabase, {
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
      supabase,
      "Admin Roles Updated",
      `${interaction.user} updated admin roles. Count: ${selectedRoleIds.length}`,
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in admin roles select handler:", errorMsg);
  }
}

async function logGuildAudit(
  supabase: SupabaseClient,
  entry: {
    guildId: string;
    actorId: string;
    action: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.from(TABLE_NAMES.GUILD_AUDIT).insert({
      guild_id: entry.guildId,
      actor_discord_id: entry.actorId,
      action: entry.action,
      details: entry.details ?? null,
    });
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
  supabase: SupabaseClient,
): Promise<void> {
  return territoryHandlers.handleShowTTSettings(interaction, supabase);
}

export async function handleTTSettingsEdit(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  return territoryHandlers.handleTTSettingsEdit(interaction, supabase);
}

export async function handleTTFilteredSettingsEdit(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  return territoryHandlers.handleTTFilteredSettingsEdit(interaction);
}

export async function handleTTNotificationTypeSelect(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  return territoryHandlers.handleTTNotificationTypeSelect(
    interaction,
    supabase,
  );
}

export async function handleTTFullChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  return territoryHandlers.handleTTFullChannelSelect(interaction, supabase);
}

export async function handleTTFilteredChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  return territoryHandlers.handleTTFilteredChannelSelect(interaction, supabase);
}

export async function handleTTFullChannelClear(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  return territoryHandlers.handleTTFullChannelClear(interaction, supabase);
}

export async function handleTTFilteredChannelClear(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  return territoryHandlers.handleTTFilteredChannelClear(interaction, supabase);
}

export async function handleTTEditTerritoriesModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  return territoryHandlers.handleTTEditTerritoriesModalSubmit(
    interaction,
    supabase,
  );
}

export async function handleTTEditFactionsModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  return territoryHandlers.handleTTEditFactionsModalSubmit(
    interaction,
    supabase,
  );
}
