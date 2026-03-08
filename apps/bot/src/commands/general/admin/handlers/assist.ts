import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Guild,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../../../lib/db-client.js";

type AssistConfig = {
  guild_id: string;
  assist_channel_id: string | null;
  ping_role_id: string | null;
  script_generation_role_ids: string[];
  is_active: boolean;
};

async function getAssistConfig(guildId: string): Promise<AssistConfig> {
  const row = await db
    .selectFrom(TABLE_NAMES.ASSIST_CONFIG)
    .selectAll()
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  // Parse script_generation_role_ids from JSON string
  let scriptRoleIds: string[] = [];
  if (row?.script_generation_role_ids) {
    try {
      const parsed = JSON.parse(row.script_generation_role_ids);
      scriptRoleIds = Array.isArray(parsed) ? parsed : [];
    } catch {
      scriptRoleIds = [];
    }
  }

  return {
    guild_id: guildId,
    assist_channel_id: row?.assist_channel_id ?? null,
    ping_role_id: row?.ping_role_id ?? null,
    script_generation_role_ids: scriptRoleIds,
    is_active: row?.is_active ? Boolean(row.is_active) : true,
  };
}

async function upsertAssistConfig(
  guildId: string,
  values: Partial<Omit<AssistConfig, "guild_id">>,
): Promise<void> {
  // Convert TypeScript types to SQLite-compatible values
  const sqliteValues: Record<string, string | number | null> = {};

  if (values.assist_channel_id !== undefined) {
    sqliteValues.assist_channel_id = values.assist_channel_id;
  }
  if (values.ping_role_id !== undefined) {
    sqliteValues.ping_role_id = values.ping_role_id;
  }
  if (values.script_generation_role_ids !== undefined) {
    // Convert array to JSON string for SQLite
    sqliteValues.script_generation_role_ids = JSON.stringify(
      values.script_generation_role_ids,
    );
  }
  if (values.is_active !== undefined) {
    // Convert boolean to integer (1 or 0) for SQLite
    sqliteValues.is_active = values.is_active ? 1 : 0;
  }

  await db
    .insertInto(TABLE_NAMES.ASSIST_CONFIG)
    .values({
      guild_id: guildId,
      ...sqliteValues,
      updated_at: new Date().toISOString(),
    })
    .onConflict((oc) =>
      oc.column("guild_id").doUpdateSet({
        ...sqliteValues,
        updated_at: new Date().toISOString(),
      }),
    )
    .execute();
}

export async function handleShowAssistSettings(
  interaction:
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ChannelSelectMenuInteraction
    | RoleSelectMenuInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred) {
      await interaction.deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }

    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .select("enabled_modules")
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    // Parse enabled_modules from JSON string
    let enabledModules: string[] = [];
    if (guildConfig?.enabled_modules) {
      try {
        const parsed = JSON.parse(guildConfig.enabled_modules);
        enabledModules = Array.isArray(parsed) ? parsed : [];
      } catch {
        enabledModules = [];
      }
    }
    if (!enabledModules.includes("assist")) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle("Assist Module Disabled")
            .setDescription(
              "This guild has not enabled the assist module yet. Use personal admin module management to enable it first.",
            ),
        ],
        components: [],
      });
      return;
    }

    const config = await getAssistConfig(guildId);

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Assist Settings")
      .setDescription(
        "Configure where combat assist alerts from the proxied script pipeline are posted.",
      )
      .addFields(
        {
          name: "Output Channel",
          value: config.assist_channel_id
            ? `<#${config.assist_channel_id}>`
            : "Not configured",
          inline: false,
        },
        {
          name: "Ping Role",
          value: config.ping_role_id ? `<@&${config.ping_role_id}>` : "None",
          inline: false,
        },
        {
          name: "Script Generation Roles",
          value:
            config.script_generation_role_ids.length > 0
              ? config.script_generation_role_ids
                  .map((id) => `<@&${id}>`)
                  .join(", ")
              : "None (Admins only)",
          inline: false,
        },
        {
          name: "Module Active",
          value: config.is_active ? "Yes" : "No",
          inline: false,
        },
      );

    const setChannelBtn = new ButtonBuilder()
      .setCustomId("assist_set_channel")
      .setLabel("Set Output Channel")
      .setStyle(ButtonStyle.Primary);

    const setRoleBtn = new ButtonBuilder()
      .setCustomId("assist_set_ping_role")
      .setLabel("Set Ping Role")
      .setStyle(ButtonStyle.Primary);

    const setScriptRolesBtn = new ButtonBuilder()
      .setCustomId("assist_set_script_roles")
      .setLabel("Set Script Roles")
      .setStyle(ButtonStyle.Primary);

    const manageUsersBtn = new ButtonBuilder()
      .setCustomId("assist_manage_users")
      .setLabel("Manage Script Users")
      .setStyle(ButtonStyle.Secondary);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_to_menu")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      setChannelBtn,
      setRoleBtn,
      setScriptRolesBtn,
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      manageUsersBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row1, row2],
    });
  } catch (error) {
    console.error("Error showing assist settings:", error);
  }
}

export async function handleAssistSetChannel(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Select Assist Output Channel")
      .setDescription(
        "Choose the channel where assist event embeds will be posted.",
      );

    const channelSelect =
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("assist_channel_select")
          .setPlaceholder("Select a text channel")
          .addChannelTypes(ChannelType.GuildText),
      );

    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("assist_settings_show")
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [embed],
      components: [channelSelect, backRow],
    });
  } catch (error) {
    console.error("Error in assist set channel:", error);
  }
}

export async function handleAssistSetPingRole(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Select Assist Ping Role")
      .setDescription(
        "Choose an optional role to ping for each assist alert. Leave empty to clear.",
      );

    const roleSelect =
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId("assist_ping_role_select")
          .setPlaceholder("Select optional ping role")
          .setMinValues(0)
          .setMaxValues(1),
      );

    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("assist_settings_show")
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [embed],
      components: [roleSelect, backRow],
    });
  } catch (error) {
    console.error("Error in assist set ping role:", error);
  }
}

export async function handleAssistChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const channelId = interaction.values[0];
    if (!guildId || !channelId) {
      return;
    }

    await upsertAssistConfig(guildId, {
      assist_channel_id: channelId,
      is_active: true,
    });

    await handleShowAssistSettings(interaction, true);
  } catch (error) {
    console.error("Error in assist channel select:", error);
  }
}

export async function handleAssistPingRoleSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }

    const roleId = interaction.values[0] ?? null;

    await upsertAssistConfig(guildId, {
      ping_role_id: roleId,
      is_active: true,
    });

    await handleShowAssistSettings(interaction, true);
  } catch (error) {
    console.error("Error in assist ping role select:", error);
  }
}

export async function handleAssistSetScriptRoles(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Select Script Generation Roles")
      .setDescription(
        "Choose roles that can generate assist script installation URLs. Leave empty for admins only.",
      );

    const roleSelect =
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId("assist_script_roles_select")
          .setPlaceholder("Select roles (optional)")
          .setMinValues(0)
          .setMaxValues(10),
      );

    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("assist_settings_show")
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [embed],
      components: [roleSelect, backRow],
    });
  } catch (error) {
    console.error("Error in assist set script roles:", error);
  }
}

export async function handleAssistScriptRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }

    const roleIds = interaction.values;

    await upsertAssistConfig(guildId, {
      script_generation_role_ids: roleIds,
      is_active: true,
    });

    await handleShowAssistSettings(interaction, true);
  } catch (error) {
    console.error("Error in assist script roles select:", error);
  }
}

// ========== USER MANAGEMENT HANDLERS ==========

const ASSIST_MANAGE_PAGE_SIZE = 10;

type ActiveAssistUser = {
  discordId: string;
  latestUpdatedAt: string | null;
  latestUsedAt: string | null;
};

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
  sentinel_assist_tokens: AssistTokensTable;
}>();

function toSqliteBoolean(value: boolean): number {
  return value ? 1 : 0;
}

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
      .setCustomId(`assist_config_user_select|${page}`)
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
    .setCustomId(`assist_config_page_prev|${page}`)
    .setLabel("Previous")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 0);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`assist_config_page_next|${page}`)
    .setLabel("Next")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= pageCount - 1);

  const backBtn = new ButtonBuilder()
    .setCustomId("assist_settings_show")
    .setLabel("Back to Assist Settings")
    .setStyle(ButtonStyle.Secondary);

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      prevBtn,
      nextBtn,
      backBtn,
    ),
  );

  return { embed, components };
}

export async function handleAssistManageUsers(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }

    const { embed, components } = await buildManageUsersView(
      guildId,
      0,
      interaction.guild,
    );
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    console.error("Error showing assist manage users:", error);
  }
}

export async function handleAssistManagePageButton(
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
      "assist_config_page_prev|",
    );
    const nextParts = parseManageCustomId(
      interaction.customId,
      "assist_config_page_next|",
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

export async function handleAssistManageUserSelect(
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
      "assist_config_user_select|",
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
      .setCustomId(`assist_config_action_select|${userId}|${page}`)
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
      .setCustomId(`assist_config_manage_back|${page}`)
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

export async function handleAssistManageActionSelect(
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
      "assist_config_action_select|",
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

export async function handleAssistManageBackButton(
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
      "assist_config_manage_back|",
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
