/**
 * Assist Command Module
 * Manages assist script token generation and revocation
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../../lib/db-client.js";
import { randomUUID } from "crypto";
import { isDev } from "../../../lib/bot-config.js";
import {
  createSignedInstallUrl,
  getLinkValidityDescription,
} from "../../../lib/assist-link-signing.js";

function getScriptUrlBase(): string {
  const configuredProd = process.env.ASSIST_INSTALL_BASE_URL;
  const configuredLocal = process.env.ASSIST_INSTALL_BASE_URL_LOCAL;

  if (!isDev && !configuredProd) {
    throw new Error(
      "Missing ASSIST_INSTALL_BASE_URL for production environment",
    );
  }

  const rawValue = isDev
    ? configuredLocal || configuredProd || "http://127.0.0.1:8787/install"
    : configuredProd!;

  try {
    const parsed = new URL(rawValue);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    throw new Error(`Invalid assist install base URL configured: ${rawValue}`);
  }
}

const SCRIPT_URL_BASE = getScriptUrlBase();
const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;

if (!botOwnerId) {
  throw new Error("Missing SENTINEL_DISCORD_USER_ID environment variable");
}

export const data = new SlashCommandBuilder()
  .setName("assist")
  .setDescription("Manage combat assist script tokens")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("generate")
      .setDescription(
        "Generate a unique assist script installation URL for yourself",
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("revoke")
      .setDescription(
        "Revoke compromised assist token(s) for a user (admins only)",
      )
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("Discord user whose assist tokens should be revoked")
          .setRequired(true),
      ),
  );

/**
 * Check if user has permission to generate scripts based on configured roles
 */
async function canGenerateScript(
  guildId: string,
  userId: string,
  userRoles: string[],
): Promise<boolean> {
  if (userId === botOwnerId) {
    return true;
  }

  const { data: guildConfig } = await db
    .from(TABLE_NAMES.GUILD_CONFIG)
    .select("admin_role_ids")
    .eq("guild_id", guildId)
    .maybeSingle();

  const adminRoleIds: string[] = guildConfig?.admin_role_ids || [];
  const isAdmin = adminRoleIds.some((roleId) => userRoles.includes(roleId));

  if (isAdmin) {
    return true;
  }

  const { data: assistConfig } = await db
    .from(TABLE_NAMES.ASSIST_CONFIG)
    .select("script_generation_role_ids")
    .eq("guild_id", guildId)
    .maybeSingle();

  const scriptRoleIds: string[] =
    assistConfig?.script_generation_role_ids || [];

  if (scriptRoleIds.length === 0) {
    return false;
  }

  return scriptRoleIds.some((roleId) => userRoles.includes(roleId));
}

/**
 * Check if user is admin (for revoke command)
 */
async function isAdmin(
  guildId: string,
  userId: string,
  userRoles: string[],
): Promise<boolean> {
  if (userId === botOwnerId) {
    return true;
  }

  const { data: guildConfig } = await db
    .from(TABLE_NAMES.GUILD_CONFIG)
    .select("admin_role_ids")
    .eq("guild_id", guildId)
    .maybeSingle();

  const adminRoleIds: string[] = guildConfig?.admin_role_ids || [];
  return adminRoleIds.some((roleId) => userRoles.includes(roleId));
}

/**
 * Get user's Torn ID from verified users table
 */
async function getUserTornId(
  _guildId: string,
  discordId: string,
): Promise<number | null> {
  const { data } = await db
    .from(TABLE_NAMES.VERIFIED_USERS)
    .select("torn_id")
    .eq("discord_id", discordId)
    .maybeSingle();

  return data?.torn_id ?? null;
}

async function handleGenerateSubcommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (!guildId) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription("This command can only be used in a guild.");

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const { data: guildConfig } = await db
    .from(TABLE_NAMES.GUILD_CONFIG)
    .select("enabled_modules")
    .eq("guild_id", guildId)
    .maybeSingle();

  const enabledModules: string[] = guildConfig?.enabled_modules || [];
  if (!enabledModules.includes("assist")) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("Assist Module Disabled")
      .setDescription(
        "This guild has not enabled the assist module yet. Contact an admin to enable it.",
      );

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const userRoles = interaction.member?.roles;
  const userRoleIds =
    userRoles && "cache" in userRoles ? Array.from(userRoles.cache.keys()) : [];

  const hasPermission = await canGenerateScript(guildId, userId, userRoleIds);
  if (!hasPermission) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Not Authorized")
      .setDescription(
        "You do not have permission to generate assist script tokens. Contact an admin to configure script generation roles.",
      );

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const tornId = await getUserTornId(guildId, userId);
  if (!tornId) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Not Verified")
      .setDescription(
        "You must be verified to generate an assist script. Use `/verify` first.",
      );

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const tokenUuid = randomUUID();

  const { error: insertError } = await db
    .from(TABLE_NAMES.ASSIST_TOKENS)
    .insert({
      guild_id: guildId,
      discord_id: userId,
      torn_id: tornId,
      token_uuid: tokenUuid,
      label: "Generated via /assist generate",
      is_active: true,
    });

  if (insertError) {
    console.error("Error inserting assist token:", insertError);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription("Failed to generate assist token. Please try again.");

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const installUrl = createSignedInstallUrl(SCRIPT_URL_BASE, tokenUuid);
  const linkValidity = getLinkValidityDescription();

  try {
    const dmEmbed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("🎯 Assist Script Generated")
      .setDescription(
        "Your personal assist script installation URL has been generated. Click the link below to install:",
      )
      .addFields(
        {
          name: "Installation URL",
          value: `\`\`\`\n${installUrl}\n\`\`\``,
          inline: false,
        },
        {
          name: "⚠️ Important",
          value:
            "Keep this URL private! Do not share it with anyone. If compromised, ask an admin to run `/assist revoke` for your user.",
          inline: false,
        },
        {
          name: "Link Validity",
          value: `This download link expires in ${linkValidity}. Once installed, the script works forever.`,
          inline: false,
        },
        {
          name: "Guild",
          value: interaction.guild?.name ?? "Unknown",
          inline: true,
        },
      )
      .setFooter({ text: "Sentinel Assist" })
      .setTimestamp();

    await interaction.user.send({ embeds: [dmEmbed] });

    const confirmEmbed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("✅ Script Generated")
      .setDescription(
        "Your assist script installation URL has been sent to your DMs. Check your messages!",
      );

    await interaction.editReply({ embeds: [confirmEmbed] });
  } catch (dmError) {
    console.error("Error sending DM:", dmError);

    const fallbackEmbed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("⚠️ Script Generated (DM Failed)")
      .setDescription(
        "Your assist script has been generated, but I couldn't DM you. Here's your installation URL (keep it private!):",
      )
      .addFields(
        {
          name: "Installation URL",
          value: `\`\`\`\n${installUrl}\n\`\`\``,
          inline: false,
        },
        {
          name: "⚠️ Security Warning",
          value:
            "This message is only visible to you, but delete it after copying the URL. Never share this link!",
          inline: false,
        },
      );

    await interaction.editReply({ embeds: [fallbackEmbed] });
  }
}

async function handleRevokeSubcommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const targetUser = interaction.options.getUser("user", true);

  if (!guildId) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription("This command can only be used in a guild.");

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const { data: guildConfig } = await db
    .from(TABLE_NAMES.GUILD_CONFIG)
    .select("enabled_modules")
    .eq("guild_id", guildId)
    .maybeSingle();

  const enabledModules: string[] = guildConfig?.enabled_modules || [];
  if (!enabledModules.includes("assist")) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("Assist Module Disabled")
      .setDescription(
        "This guild has not enabled the assist module yet. Contact an admin to enable it.",
      );

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const userRoles = interaction.member?.roles;
  const userRoleIds =
    userRoles && "cache" in userRoles ? Array.from(userRoles.cache.keys()) : [];

  const userIsAdmin = await isAdmin(guildId, userId, userRoleIds);
  if (!userIsAdmin) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Not Authorized")
      .setDescription(
        "Only admins can revoke assist tokens. This command is for managing compromised tokens.",
      );

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const { data: tokens, error: tokensError } = await db
    .from(TABLE_NAMES.ASSIST_TOKENS)
    .select("token_uuid")
    .eq("guild_id", guildId)
    .eq("discord_id", targetUser.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (tokensError) {
    console.error("Error fetching active tokens for revoke:", tokensError);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription("Failed to look up active tokens. Please try again.");

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  if (!tokens || tokens.length === 0) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("No Active Tokens")
      .setDescription(
        `No active assist tokens found for ${targetUser.toString()} in this guild.`,
      );

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const { error: revokeError } = await db
    .from(TABLE_NAMES.ASSIST_TOKENS)
    .delete()
    .eq("guild_id", guildId)
    .eq("discord_id", targetUser.id)
    .eq("is_active", true);

  if (revokeError) {
    console.error("Error deleting compromised assist tokens:", revokeError);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription("Failed to revoke tokens. Please try again.");

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const successEmbed = new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle("✅ Tokens Revoked")
    .setDescription(
      `Revoked ${tokens.length} compromised token(s) for ${targetUser.toString()}.`,
    );

  await interaction.editReply({ embeds: [successEmbed], components: [] });
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "generate": {
        await handleGenerateSubcommand(interaction);
        break;
      }
      case "revoke": {
        await handleRevokeSubcommand(interaction);
        break;
      }
      default: {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Unknown Subcommand")
          .setDescription(`Unknown subcommand: ${subcommand}`);

        await interaction.editReply({ embeds: [errorEmbed] });
        break;
      }
    }
  } catch (error) {
    console.error("Error in assist command:", error);

    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed] });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
