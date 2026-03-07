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

interface AssistConfigTable {
  guild_id: string;
  script_generation_role_ids: string;
}

interface AssistTokensTable {
  id?: number;
  guild_id: string;
  discord_id: string;
  torn_id: number;
  token_uuid: string;
  label?: string | null;
  strike_count?: number;
  is_active: number;
  blacklisted_at?: string | null;
  blacklisted_reason?: string | null;
  expires_at?: string | null;
  last_used_at?: string | null;
  last_seen_ip?: string | null;
  last_seen_user_agent?: string | null;
  created_at?: string;
  updated_at?: string;
}

const assistDb = db.withTables<{
  sentinel_assist_config: AssistConfigTable;
  sentinel_assist_tokens: AssistTokensTable;
}>();

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function toSqliteBoolean(value: boolean): number {
  return value ? 1 : 0;
}

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

  const guildConfig = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["admin_role_ids"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  const adminRoleIds = parseStringArray(guildConfig?.admin_role_ids);
  const isAdmin = adminRoleIds.some((roleId) => userRoles.includes(roleId));

  if (isAdmin) {
    return true;
  }

  const assistConfig = await assistDb
    .selectFrom(TABLE_NAMES.ASSIST_CONFIG)
    .select(["script_generation_role_ids"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  const scriptRoleIds = parseStringArray(
    assistConfig?.script_generation_role_ids,
  );

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

  const guildConfig = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["admin_role_ids"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  const adminRoleIds = parseStringArray(guildConfig?.admin_role_ids);
  return adminRoleIds.some((roleId) => userRoles.includes(roleId));
}

/**
 * Get user's Torn ID from verified users table
 */
async function getUserTornId(
  _guildId: string,
  discordId: string,
): Promise<number | null> {
  const data = await db
    .selectFrom(TABLE_NAMES.VERIFIED_USERS)
    .select(["torn_id"])
    .where("discord_id", "=", discordId)
    .executeTakeFirst();

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

  const guildConfig = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["enabled_modules"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  const enabledModules = parseStringArray(guildConfig?.enabled_modules);
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
  let revokedActiveTokens = 0;

  try {
    await assistDb.transaction().execute(async (trx) => {
      const nowIso = new Date().toISOString();

      const activeTokens = await trx
        .selectFrom(TABLE_NAMES.ASSIST_TOKENS)
        .select(["id"])
        .where("guild_id", "=", guildId)
        .where("discord_id", "=", userId)
        .where("is_active", "=", toSqliteBoolean(true))
        .execute();

      revokedActiveTokens = activeTokens.length;

      if (revokedActiveTokens > 0) {
        await trx
          .updateTable(TABLE_NAMES.ASSIST_TOKENS)
          .set({
            is_active: toSqliteBoolean(false),
            blacklisted_at: nowIso,
            blacklisted_reason: "superseded_by_new_token",
            updated_at: nowIso,
          })
          .where("guild_id", "=", guildId)
          .where("discord_id", "=", userId)
          .where("is_active", "=", toSqliteBoolean(true))
          .execute();
      }

      await trx
        .insertInto(TABLE_NAMES.ASSIST_TOKENS)
        .values({
          guild_id: guildId,
          discord_id: userId,
          torn_id: tornId,
          token_uuid: tokenUuid,
          label: "Generated via /assist generate",
          is_active: toSqliteBoolean(true),
        })
        .execute();
    });
  } catch (insertError) {
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

    if (revokedActiveTokens > 0) {
      dmEmbed.addFields({
        name: "Previous Active Tokens",
        value: `Revoked ${revokedActiveTokens} old active token${revokedActiveTokens === 1 ? "" : "s"} before generating this one.`,
        inline: false,
      });
    }

    await interaction.user.send({ embeds: [dmEmbed] });

    const confirmEmbed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("✅ Script Generated")
      .setDescription(
        "Your assist script installation URL has been sent to your DMs. Check your messages!",
      );

    if (revokedActiveTokens > 0) {
      confirmEmbed.addFields({
        name: "Security",
        value: `Revoked ${revokedActiveTokens} previously active token${revokedActiveTokens === 1 ? "" : "s"}.`,
        inline: false,
      });
    }

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

  const guildConfig = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["enabled_modules"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  const enabledModules = parseStringArray(guildConfig?.enabled_modules);
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

  let tokens: Array<{ token_uuid: string }> = [];
  try {
    tokens = (await assistDb
      .selectFrom(TABLE_NAMES.ASSIST_TOKENS)
      .select(["token_uuid"])
      .where("guild_id", "=", guildId)
      .where("discord_id", "=", targetUser.id)
      .where("is_active", "=", toSqliteBoolean(true))
      .orderBy("created_at", "desc")
      .execute()) as Array<{ token_uuid: string }>;
  } catch (tokensError) {
    console.error("Error fetching active tokens for revoke:", tokensError);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription("Failed to look up active tokens. Please try again.");

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  if (tokens.length === 0) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("No Active Tokens")
      .setDescription(
        `No active assist tokens found for ${targetUser.toString()} in this guild.`,
      );

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  try {
    await assistDb
      .deleteFrom(TABLE_NAMES.ASSIST_TOKENS)
      .where("guild_id", "=", guildId)
      .where("discord_id", "=", targetUser.id)
      .where("is_active", "=", toSqliteBoolean(true))
      .execute();
  } catch (revokeError) {
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
