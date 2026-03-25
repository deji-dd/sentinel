import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  GuildMemberRoleManager,
  MessageFlags,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  type ChannelSelectMenuInteraction,
} from "discord.js";
import { db } from "../../../lib/db-client.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getApiUrl } from "../../../lib/bot-config.js";
import { MagicLinkService } from "../../../services/magic-link-service.js";

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

  const magicLinkService = new MagicLinkService(interaction.client);
  const token = await magicLinkService.createToken({
    discordId: interaction.user.id,
    guildId: guildId,
    scope: "map",
    targetPath: "/territories",
  });

  const dashboardUrl = `${getApiUrl()}/api/auth/magic-link?token=${token}`;

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("TT Selector Management")
    .setDescription(`Management for territory configurations.`)
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Open Web Dashboard")
      .setStyle(ButtonStyle.Link)
      .setURL(dashboardUrl),
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// Button/Select/Modal handlers below can be removed as they are now handled in the UI
// Keeping exports empty to avoid breaking the interaction router if it still tries to call them
export async function handleButtonInteraction(
  _interaction: ButtonInteraction,
): Promise<void> {}
export async function handleStringSelectMenuInteraction(
  _interaction: StringSelectMenuInteraction,
): Promise<void> {}
export async function handleChannelSelectMenuInteraction(
  _interaction: ChannelSelectMenuInteraction,
): Promise<void> {}
export async function handleModalSubmitInteraction(
  _interaction: ModalSubmitInteraction,
): Promise<void> {}
