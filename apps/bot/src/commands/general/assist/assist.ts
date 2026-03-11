/**
 * Assist Command Module
 * Manages assist script token generation and revocation
 */

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
  type Guild,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
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
  const configuredProd = process.env.BOT_ORIGIN;
  const configuredLocal = process.env.BOT_ORIGIN_LOCAL;

  if (!isDev && !configuredProd) {
    throw new Error("Missing BOT_ORIGIN for production environment");
  }

  const rawValue = isDev
    ? configuredLocal || configuredProd || "http://127.0.0.1:3001"
    : configuredProd!;

  try {
    const parsed = new URL(rawValue);
    return `${parsed.origin}/install`;
  } catch {
    throw new Error(`Invalid bot origin URL configured: ${rawValue}`);
  }
}

const SCRIPT_URL_BASE = getScriptUrlBase();
const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
const ASSIST_MANAGE_PAGE_SIZE = 10;

if (!botOwnerId) {
  throw new Error("Missing SENTINEL_DISCORD_USER_ID environment variable");
}

export const data = new SlashCommandBuilder()
  .setName("assist")
  .setDescription("Generate combat assist script installation URL")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("generate")
      .setDescription(
        "Generate a unique assist script installation URL for yourself",
      ),
  );

type ActiveAssistUser = {
  discordId: string;
  latestUpdatedAt: string | null;
  latestUsedAt: string | null;
};

function parseManageCustomId(
  customId: string,
  prefix: string,
): string[] | null {
  if (!customId.startsWith(prefix)) {
    return null;
  }

  const remainder = customId.slice(prefix.length);
  return remainder.split("|");
}

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

async function getActiveAssistUsers(
  guildId: string,
): Promise<ActiveAssistUser[]> {
  const rows = await assistDb
    .selectFrom(TABLE_NAMES.ASSIST_TOKENS)
    .select(["discord_id", "updated_at", "last_used_at"])
    .where("guild_id", "=", guildId)
    .where("is_active", "=", toSqliteBoolean(true))
    .where("blacklisted_at", "is", null)
    .execute();

  const userMap = new Map<string, ActiveAssistUser>();

  for (const row of rows) {
    const existing = userMap.get(row.discord_id);
    const updatedAt = row.updated_at ?? null;
    const lastUsedAt = row.last_used_at ?? null;

    if (!existing) {
      userMap.set(row.discord_id, {
        discordId: row.discord_id,
        latestUpdatedAt: updatedAt,
        latestUsedAt: lastUsedAt,
      });
      continue;
    }

    if (
      updatedAt &&
      (!existing.latestUpdatedAt ||
        new Date(updatedAt).getTime() >
          new Date(existing.latestUpdatedAt).getTime())
    ) {
      existing.latestUpdatedAt = updatedAt;
    }

    if (
      lastUsedAt &&
      (!existing.latestUsedAt ||
        new Date(lastUsedAt).getTime() >
          new Date(existing.latestUsedAt).getTime())
    ) {
      existing.latestUsedAt = lastUsedAt;
    }
  }

  return Array.from(userMap.values()).sort((a, b) => {
    const aTime = a.latestUsedAt || a.latestUpdatedAt || "";
    const bTime = b.latestUsedAt || b.latestUpdatedAt || "";
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });
}

function formatRelativeActivity(value: string | null): string {
  if (!value) {
    return "never";
  }

  const deltaMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return "just now";
  }

  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function buildManageUsersView(
  guildId: string,
  requestedPage: number,
  guild?: Guild | null,
  notice?: string,
): Promise<{
  embed: EmbedBuilder;
  components: Array<
    ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>
  >;
}> {
  const users = await getActiveAssistUsers(guildId);
  const pageCount = Math.max(
    1,
    Math.ceil(users.length / ASSIST_MANAGE_PAGE_SIZE),
  );
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  const start = page * ASSIST_MANAGE_PAGE_SIZE;
  const pageUsers = users.slice(start, start + ASSIST_MANAGE_PAGE_SIZE);
  const displayNameByUserId = new Map<string, string>();

  await Promise.all(
    pageUsers.map(async (entry) => {
      let displayName = entry.discordId;

      try {
        if (guild) {
          const member = await guild.members.fetch(entry.discordId);
          displayName =
            member.displayName ||
            member.user.globalName ||
            member.user.username;
        }
      } catch {
        displayName = entry.discordId;
      }

      displayNameByUserId.set(entry.discordId, displayName.slice(0, 100));
    }),
  );

  const descriptionLines: string[] = [];

  if (notice) {
    descriptionLines.push(notice, "");
  }

  if (pageUsers.length === 0) {
    descriptionLines.push("No active assist script users found in this guild.");
  } else {
    descriptionLines.push(
      ...pageUsers.map(
        (entry, index) =>
          `${start + index + 1}. <@${entry.discordId}> | last used: ${formatRelativeActivity(entry.latestUsedAt || entry.latestUpdatedAt)}`,
      ),
    );
  }

  const embed = new EmbedBuilder()
    .setColor(0x2563eb)
    .setTitle("Assist Active Script Users")
    .setDescription(descriptionLines.join("\n"))
    .setFooter({
      text: `Page ${page + 1}/${pageCount} • Total active users: ${users.length}`,
    });

  const components: Array<
    ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>
  > = [];

  if (pageUsers.length > 0) {
    const userSelect = new StringSelectMenuBuilder()
      .setCustomId(`assist_manage_user_select|${page}`)
      .setPlaceholder("Select a user to manage")
      .addOptions(
        pageUsers.map((entry) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(
              displayNameByUserId.get(entry.discordId) || entry.discordId,
            )
            .setDescription(
              `Last used: ${formatRelativeActivity(entry.latestUsedAt || entry.latestUpdatedAt)}`,
            )
            .setValue(entry.discordId),
        ),
      );

    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(userSelect),
    );
  }

  const prevBtn = new ButtonBuilder()
    .setCustomId(`assist_manage_page_prev|${page}`)
    .setLabel("Previous")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 0);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`assist_manage_page_next|${page}`)
    .setLabel("Next")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= pageCount - 1);

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn),
  );

  return { embed, components };
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

  // Check if user is blacklisted by admin (permanent ban)
  const adminBlacklist = await assistDb
    .selectFrom(TABLE_NAMES.ASSIST_TOKENS)
    .select(["blacklisted_reason"])
    .where("guild_id", "=", guildId)
    .where("discord_id", "=", userId)
    .where("blacklisted_reason", "=", "blacklisted_by_admin")
    .executeTakeFirst();

  if (adminBlacklist) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Blacklisted")
      .setDescription(
        "You have been blacklisted from generating assist scripts. Contact an admin to appeal.",
      );

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  // Check if most recent token is disabled by admin (temporary ban)
  const latestToken = await assistDb
    .selectFrom(TABLE_NAMES.ASSIST_TOKENS)
    .select(["is_active", "blacklisted_at"])
    .where("guild_id", "=", guildId)
    .where("discord_id", "=", userId)
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();

  if (
    latestToken &&
    latestToken.is_active === toSqliteBoolean(false) &&
    !latestToken.blacklisted_at
  ) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("❌ Disabled")
      .setDescription(
        "Your assist script access has been disabled. Contact an admin to re-enable it.",
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





export async function handleManagePageButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }

    const prevParts = parseManageCustomId(
      interaction.customId,
      "assist_manage_page_prev|",
    );
    const nextParts = parseManageCustomId(
      interaction.customId,
      "assist_manage_page_next|",
    );

    const basePage = Number.parseInt(
      prevParts?.[0] || nextParts?.[0] || "0",
      10,
    );
    const currentPage = Number.isFinite(basePage) ? basePage : 0;
    const page = prevParts ? currentPage - 1 : currentPage + 1;

    const { embed, components } = await buildManageUsersView(
      guildId,
      page,
      interaction.guild,
    );
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    console.error("Error handling assist manage page button:", error);
  }
}

export async function handleManageUserSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }

    const userId = interaction.values[0];
    if (!userId) {
      return;
    }

    const parts = parseManageCustomId(
      interaction.customId,
      "assist_manage_user_select|",
    );
    const page = Number.parseInt(parts?.[0] || "0", 10) || 0;

    const tokenRows = await assistDb
      .selectFrom(TABLE_NAMES.ASSIST_TOKENS)
      .select(["id"])
      .where("guild_id", "=", guildId)
      .where("discord_id", "=", userId)
      .execute();

    const actionEmbed = new EmbedBuilder()
      .setColor(0x1d4ed8)
      .setTitle("Manage Assist Script User")
      .setDescription(
        `Selected user: <@${userId}>\nToken rows in guild: ${tokenRows.length}\n\nChoose an action below.`,
      );

    const actionSelect = new StringSelectMenuBuilder()
      .setCustomId(`assist_manage_action_select|${userId}|${page}`)
      .setPlaceholder("Select an action")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Enable")
          .setDescription("Mark all user tokens as active and clear blacklist")
          .setValue("enable"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Disable")
          .setDescription("Disable all user tokens without deleting")
          .setValue("disable"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Delete")
          .setDescription("Permanently remove all user tokens")
          .setValue("delete"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Blacklist")
          .setDescription("Disable and blacklist all user tokens")
          .setValue("blacklist"),
      );

    const backButton = new ButtonBuilder()
      .setCustomId(`assist_manage_back|${page}`)
      .setLabel("Back to user list")
      .setStyle(ButtonStyle.Secondary);

    await interaction.editReply({
      embeds: [actionEmbed],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          actionSelect,
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(backButton),
      ],
    });
  } catch (error) {
    console.error("Error handling assist manage user select:", error);
  }
}

export async function handleManageActionSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }

    const parts = parseManageCustomId(
      interaction.customId,
      "assist_manage_action_select|",
    );
    if (!parts || parts.length < 3) {
      return;
    }

    const [targetDiscordId, pageRaw] = parts;
    const page = Number.parseInt(pageRaw || "0", 10) || 0;
    const action = interaction.values[0];
    const now = new Date().toISOString();

    if (!targetDiscordId || !action) {
      return;
    }

    if (action === "enable") {
      await assistDb
        .updateTable(TABLE_NAMES.ASSIST_TOKENS)
        .set({
          is_active: toSqliteBoolean(true),
          blacklisted_at: null,
          blacklisted_reason: null,
          updated_at: now,
        })
        .where("guild_id", "=", guildId)
        .where("discord_id", "=", targetDiscordId)
        .execute();
    } else if (action === "disable") {
      await assistDb
        .updateTable(TABLE_NAMES.ASSIST_TOKENS)
        .set({
          is_active: toSqliteBoolean(false),
          updated_at: now,
        })
        .where("guild_id", "=", guildId)
        .where("discord_id", "=", targetDiscordId)
        .execute();
    } else if (action === "delete") {
      await assistDb
        .deleteFrom(TABLE_NAMES.ASSIST_TOKENS)
        .where("guild_id", "=", guildId)
        .where("discord_id", "=", targetDiscordId)
        .execute();
    } else if (action === "blacklist") {
      await assistDb
        .updateTable(TABLE_NAMES.ASSIST_TOKENS)
        .set({
          is_active: toSqliteBoolean(false),
          blacklisted_at: now,
          blacklisted_reason: "blacklisted_by_admin",
          updated_at: now,
        })
        .where("guild_id", "=", guildId)
        .where("discord_id", "=", targetDiscordId)
        .execute();
    }

    const notice = `Updated <@${targetDiscordId}>: ${action}`;
    const { embed, components } = await buildManageUsersView(
      guildId,
      page,
      interaction.guild,
      notice,
    );
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    console.error("Error handling assist manage action select:", error);
  }
}

export async function handleManageBackButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }

    const parts = parseManageCustomId(
      interaction.customId,
      "assist_manage_back|",
    );
    const page = Number.parseInt(parts?.[0] || "0", 10) || 0;
    const { embed, components } = await buildManageUsersView(
      guildId,
      page,
      interaction.guild,
    );
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    console.error("Error handling assist manage back button:", error);
  }
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "generate") {
      await handleGenerateSubcommand(interaction);
    } else {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Unknown Subcommand")
        .setDescription(`Unknown subcommand: ${subcommand}`);

      await interaction.editReply({ embeds: [errorEmbed] });
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
