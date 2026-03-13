import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  GuildMemberRoleManager,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ChannelSelectMenuBuilder,
  ChannelType,
  type ChannelSelectMenuInteraction,
} from "discord.js";
import { db } from "../../../lib/db-client.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { randomBytes, randomUUID } from "crypto";

export const data = new SlashCommandBuilder()
  .setName("tt-selector")
  .setDescription(
    "Create, edit, and publish custom territory configurations (TT Selector)",
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Permission Check
  const guildConfig = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["admin_role_ids"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
  const adminRoleIds: string[] = guildConfig?.admin_role_ids
    ? typeof guildConfig.admin_role_ids === "string"
      ? JSON.parse(guildConfig.admin_role_ids)
      : guildConfig.admin_role_ids
    : [];

  const isOwner = interaction.user.id === botOwnerId;
  const roles = interaction.member?.roles;
  const hasAdminRole =
    adminRoleIds.length > 0 &&
    roles instanceof GuildMemberRoleManager &&
    roles.cache.some((r) => adminRoleIds.includes(r.id));

  if (!isOwner && !hasAdminRole) {
    await interaction.reply({
      content:
        "**Not Authorized**: Only server admins or the bot owner can use the TT Selector.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Fetch existing maps for this guild (Only those created by THIS user for privacy)
  const maps = await db
    .selectFrom(TABLE_NAMES.MAPS)
    .selectAll()
    .where("guild_id", "=", guildId)
    .where("created_by", "=", interaction.user.id)
    .execute();

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("TT Selector Control Panel")
    .setDescription(
      maps.length > 0
        ? `You have **${maps.length}** configuration(s) for this server.`
        : "No configurations found. Create your first one to get started!",
    )
    .setTimestamp();

  if (maps.length > 0) {
    const mapList = maps
      .map((m) => `• **${m.name}** (ID: \`${m.id.substring(0, 8)}\`)`)
      .join("\n");
    embed.addFields({ name: "Existing Configurations", value: mapList });
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("tt_selector_create")
      .setLabel("Create New TT Config")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("tt_selector_edit_list")
      .setLabel("Edit Config")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(maps.length === 0),
    new ButtonBuilder()
      .setCustomId("tt_selector_publish_list")
      .setLabel("Publish Config")
      .setStyle(ButtonStyle.Success)
      .setDisabled(maps.length === 0),
  );

  await interaction.reply({ embeds: [embed], components: [row] });
}

export async function handleButtonInteraction(
  interaction: ButtonInteraction,
): Promise<void> {
  const { customId, guildId } = interaction;

  if (customId === "tt_selector_create") {
    const modal = new ModalBuilder()
      .setCustomId("tt_selector_create_modal")
      .setTitle("Create New TT Config");

    const nameInput = new TextInputBuilder()
      .setCustomId("map_name")
      .setLabel("Config Name")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. Faction War Plan")
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    );
    await interaction.showModal(modal);
  } else if (customId === "tt_selector_edit_list") {
    const maps = await db
      .selectFrom(TABLE_NAMES.MAPS)
      .selectAll()
      .where("guild_id", "=", guildId!)
      .where("created_by", "=", interaction.user.id)
      .execute();

    if (maps.length === 0) {
      await interaction.reply({
        content: "No configurations found to edit.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Select TT Config to Edit")
      .setDescription(
        "Select a configuration from the menu below to open the selector.",
      );

    const select = new StringSelectMenuBuilder()
      .setCustomId("tt_selector_edit_select")
      .setPlaceholder("Choose a configuration...")
      .addOptions(
        maps.map((m) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(m.name || "Unnamed Config")
            .setDescription(`ID: ${m.id.slice(0, 8)}`)
            .setValue(m.id),
        ),
      );

    const selectRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    await interaction.reply({
      embeds: [embed],
      components: [selectRow],
      flags: MessageFlags.Ephemeral,
    });
  } else if (customId === "tt_selector_publish_list") {
    const maps = await db
      .selectFrom(TABLE_NAMES.MAPS)
      .selectAll()
      .where("guild_id", "=", guildId!)
      .where("created_by", "=", interaction.user.id)
      .execute();

    if (maps.length === 0) {
      await interaction.reply({
        content: "No configurations found to publish.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("Select TT Config to Publish")
      .setDescription(
        "Select a configuration to generate a global screenshot and summary.",
      );

    const select = new StringSelectMenuBuilder()
      .setCustomId("tt_selector_publish_select")
      .setPlaceholder("Choose a configuration to publish...")
      .addOptions(
        maps.map((m) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(m.name || "Unnamed Config")
            .setDescription(`ID: ${m.id.slice(0, 8)}`)
            .setValue(m.id),
        ),
      );

    const selectRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    await interaction.reply({
      embeds: [embed],
      components: [selectRow],
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleStringSelectMenuInteraction(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const { customId, values, user } = interaction;
  const mapId = values[0];

  if (customId === "tt_selector_edit_select") {
    // Security: Validate ownership before generating session
    const map = await db
      .selectFrom(TABLE_NAMES.MAPS)
      .select("created_by")
      .where("id", "=", mapId)
      .executeTakeFirst();

    if (!map || map.created_by !== user.id) {
      await interaction.reply({
        content: "Error: You do not have permission to edit this configuration.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const token = await createSession(mapId, user.id);
    const painterUrl = `${process.env.MAP_PAINTER_URL || "http://localhost:3000"}/selector?token=${token}`;

    await interaction.reply({
      content: `**TT Selector Access Generated**\n[Click here to open the TT Selector](${painterUrl})\n*Access token is valid for 30 minutes.*`,
      flags: MessageFlags.Ephemeral,
    });
  } else if (customId === "tt_selector_publish_select") {
    const map = await db
      .selectFrom(TABLE_NAMES.MAPS)
      .selectAll()
      .where("id", "=", mapId)
      .executeTakeFirst();

    if (!map || map.created_by !== user.id) {
      await interaction.reply({
        content: "Error: You do not have permission to publish this configuration.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const select = new ChannelSelectMenuBuilder()
      .setCustomId(`tt_selector_publish_channel:${mapId}`)
      .setPlaceholder("Select a channel to publish to...")
      .addChannelTypes(ChannelType.GuildText);

    const row = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      select,
    );
    await interaction.update({
      content: `**Step 2: Destination**\nWhich channel should the "**${map.name}**" config be published to?`,
      embeds: [],
      components: [row],
    });
  }
}

export async function handleChannelSelectMenuInteraction(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  const { customId, values, guild } = interaction;

  if (customId.startsWith("tt_selector_publish_channel:")) {
    const mapId = customId.split(":")[1];
    const channelId = values[0];
    const channel = guild?.channels.cache.get(channelId);

    if (!channel || !channel.isTextBased()) {
      await interaction.reply({
        content: "Invalid channel selected.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const map = await db
      .selectFrom(TABLE_NAMES.MAPS)
      .selectAll()
      .where("id", "=", mapId)
      .executeTakeFirst();

    if (!map || map.created_by !== interaction.user.id) {
      await interaction.reply({
        content: "Error: Configuration not found or access denied.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const labels = await db
      .selectFrom(TABLE_NAMES.MAP_LABELS)
      .selectAll()
      .where("map_id", "=", mapId)
      .execute();

    const assignments = await db
      .selectFrom(TABLE_NAMES.MAP_TERRITORIES)
      .select(["territory_id", "label_id"])
      .where("map_id", "=", mapId)
      .execute();

    const tids = assignments.map((a) => a.territory_id);
    const blueprints = await db
      .selectFrom(TABLE_NAMES.TERRITORY_BLUEPRINT)
      .selectAll()
      .where("id", "in", tids)
      .execute();

    const states = await db
      .selectFrom(TABLE_NAMES.TERRITORY_STATE)
      .selectAll()
      .where("territory_id", "in", tids)
      .execute();

    const embeds: EmbedBuilder[] = [];

    // Main Header Embed
    embeds.push(
      new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(map.name)
        .setDescription(
          `This configuration was published by <@${interaction.user.id}>.`,
        )
        .setTimestamp(),
    );

    for (const label of labels) {
      const labelAssignments = assignments.filter(
        (a) => a.label_id === label.id,
      );
      if (labelAssignments.length === 0) continue;

      const lines = labelAssignments.map((a) => {
        const st = states.find((s) => s.territory_id === a.territory_id);

        let info = `• [**${a.territory_id}**](https://www.torn.com/city.php#territory=${a.territory_id})`;
        if (st?.racket_name)
          info += ` | ${st.racket_name} (L${st.racket_level})`;
        return info;
      });

      const totalRespect = labelAssignments.reduce((acc, a) => {
        const bp = blueprints.find((b) => b.id === a.territory_id);
        return acc + (bp?.respect || 0);
      }, 0);

      const sectors: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
      labelAssignments.forEach((a) => {
        const bp = blueprints.find((b) => b.id === a.territory_id);
        if (bp?.sector) sectors[bp.sector]++;
      });

      const sectorDistribution = [1, 2, 3, 4, 5, 6, 7]
        .map((s) => `**S${s}**: ${sectors[s]}`)
        .join(" | ");

      const value = lines.join("\n").substring(0, 2000);

      const labelEmbed = new EmbedBuilder()
        .setColor(parseInt(label.color_hex.replace("#", ""), 16) || 0x3b82f6)
        .setTitle(label.label_text)
        .setDescription(value)
        .addFields(
          { 
            name: "Sectors", 
            value: sectorDistribution, 
            inline: false 
          },
          {
            name: "Summary",
            value: `Territories: **${labelAssignments.length}**\nDaily Respect: **${totalRespect.toLocaleString()}**`,
            inline: true,
          }
        );

      embeds.push(labelEmbed);
    }

    if (embeds.length === 1) {
      embeds[0].setDescription(
        "This configuration has no territory assignments yet.",
      );
    }

    // Split embeds into chunks (Discord limit is 10)
    for (let i = 0; i < embeds.length; i += 10) {
      const chunk = embeds.slice(i, i + 10);
      await channel.send({ embeds: chunk });
    }

    await interaction.update({
      content: `**Config Published**\nSuccessfully published "**${map.name}**" to <#${channelId}>.`,
      components: [],
      embeds: [],
    });
  }
}

export async function handleModalSubmitInteraction(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const { customId, guildId, user } = interaction;

  if (customId === "tt_selector_create_modal") {
    const name = interaction.fields.getTextInputValue("map_name");
    const mapId = randomUUID();

    await db
      .insertInto(TABLE_NAMES.MAPS)
      .values({
        id: mapId,
        guild_id: guildId!,
        name,
        created_by: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    const token = await createSession(mapId, user.id);
    const painterUrl = `${process.env.MAP_PAINTER_URL || "http://localhost:3000"}/selector?token=${token}`;

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("TT Config Created")
      .setDescription(`Successfully created configuration "**${name}**".`)
      .addFields({
        name: "Access Link",
        value: `[Open TT Selector](${painterUrl})`,
      })
      .setFooter({ text: "Token expires in 30 minutes" });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

/**
 * Generates a secure session token and saves it to the database.
 */
export async function createSession(
  mapId: string,
  userId: string,
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString(); // 30 minutes

  await db
    .insertInto(TABLE_NAMES.MAP_SESSIONS)
    .values({
      token,
      map_id: mapId,
      user_id: userId,
      expires_at: expiresAt,
    })
    .execute();

  return token;
}
