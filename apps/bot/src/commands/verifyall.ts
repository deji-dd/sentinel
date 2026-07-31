import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  GuildMember,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "@sentinel/database";
import { sendVerificationRequest } from "../lib/ipc-client.js";
import { createBaseEmbed, createErrorEmbed, EMBED_COLORS } from "../lib/embeds.js";
import { logger } from "../lib/logger.js";

export const verifyallCommand = {
  data: new SlashCommandBuilder()
    .setName("verifyall")
    .setDescription("Runs verification check on all members in the server (Admin only)."),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild || !interaction.guildId) {
      await interaction.reply({
        embeds: [createErrorEmbed("Error", "This command can only be used in a server.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;

    // 1. Check Module Status
    const config = await db.guildConfig.findUnique({
      where: { guildId },
      select: { enabledModules: true, adminRoleIds: true },
    });

    if (!config || !config.enabledModules.includes("verification")) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            "Module Disabled",
            "The Verification module is currently disabled for this server.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 2. Permission Check
    const executorMember = interaction.member as GuildMember;
    const hasAdminRole = executorMember.roles.cache.some((role) =>
      config.adminRoleIds.includes(role.id),
    );
    const hasPermission =
      executorMember.permissions.has(PermissionFlagsBits.Administrator) ||
      executorMember.permissions.has(PermissionFlagsBits.ManageGuild);

    if (!hasAdminRole && !hasPermission) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            "Permission Denied",
            "You do not have administrator permissions to run bulk verification.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const members = await interaction.guild.members.fetch();
      const nonBotMembers = Array.from(members.values()).filter((m) => !m.user.bot);

      let processedCount = 0;
      let updatedCount = 0;
      let errorCount = 0;

      for (const member of nonBotMembers) {
        processedCount++;

        const jobData = {
          guild_id: guildId,
          channel_id: interaction.channelId,
          discord_id: member.id,
          current_role_ids: Array.from(member.roles.cache.keys()),
          current_nickname: member.nickname,
        };

        try {
          const result = await sendVerificationRequest(jobData, 10000);

          if (result.error) {
            errorCount++;
            continue;
          }

          let memberUpdated = false;

          if (result.roles_to_add && result.roles_to_add.length > 0) {
            for (const roleId of result.roles_to_add) {
              await member.roles.add(roleId).catch(() => {});
            }
            memberUpdated = true;
          }

          if (result.roles_to_remove && result.roles_to_remove.length > 0) {
            for (const roleId of result.roles_to_remove) {
              await member.roles.remove(roleId).catch(() => {});
            }
            memberUpdated = true;
          }

          if (result.new_nickname !== null) {
            await member.setNickname(result.new_nickname).catch(() => {});
            memberUpdated = true;
          }

          if (memberUpdated) {
            updatedCount++;
          }
        } catch (err) {
          errorCount++;
          logger.warn(`Failed verification job for user ${member.id}:`, err);
        }
      }

      const embed = createBaseEmbed(
        "Bulk Verification Complete",
        `Processed verification run for **${processedCount}** members.`,
        EMBED_COLORS.SUCCESS,
      ).addFields(
        { name: "Total Processed", value: `${processedCount}`, inline: true },
        { name: "Members Updated", value: `${updatedCount}`, inline: true },
        { name: "Errors / Skipped", value: `${errorCount}`, inline: true },
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error("Error executing verifyall command:", error);
      const errMsg = error instanceof Error ? error.message : String(error);
      await interaction.editReply({
        embeds: [createErrorEmbed("Bulk Verification Error", errMsg)],
      });
    }
  },
};
