import { GuildMember, Events } from "discord.js";
import { db } from "@sentinel/database";
import { sendVerificationRequest } from "../lib/ipc-client.js";
import { sendGuildAuditLog } from "../lib/guild-logger.js";
import { createBaseEmbed, createErrorEmbed, EMBED_COLORS } from "../lib/embeds.js";
import { logger } from "../lib/logger.js";

export const guildMemberAddEvent = {
  name: Events.GuildMemberAdd,
  async execute(member: GuildMember): Promise<void> {
    if (member.user.bot) return;

    try {
      const guildId = member.guild.id;
      const config = await db.guildConfig.findUnique({
        where: { guildId },
        select: { verifyOnJoin: true, enabledModules: true },
      });

      if (
        !config ||
        !config.verifyOnJoin ||
        !config.enabledModules.includes("verification")
      ) {
        return;
      }

      logger.info(`Auto-verifying joining member ${member.user.tag} [${member.id}] in guild ${guildId}...`);

      const jobData = {
        guild_id: guildId,
        channel_id: "",
        discord_id: member.id,
        current_role_ids: Array.from(member.roles.cache.keys()),
        current_nickname: member.nickname,
        triggered_by: "join" as const,
      };

      const result = await sendVerificationRequest(jobData);

      if (result.error) {
        logger.warn(`Auto-verify failed for joining member ${member.id}:`, result.error.message);
        const errorEmbed = createErrorEmbed(
          "Auto-Verification Failed",
          `Auto-verification on join failed for <@${member.id}>: ${result.error.message}`,
        );
        await sendGuildAuditLog(member.client, guildId, errorEmbed);
        return;
      }

      const rolesAdded: string[] = [];
      const rolesRemoved: string[] = [];
      const failures: string[] = [];

      if (result.roles_to_add && result.roles_to_add.length > 0) {
        for (const roleId of result.roles_to_add) {
          try {
            await member.roles.add(roleId);
            rolesAdded.push(`<@&${roleId}>`);
          } catch (err) {
            failures.push(`Failed to add <@&${roleId}>`);
          }
        }
      }

      if (result.roles_to_remove && result.roles_to_remove.length > 0) {
        for (const roleId of result.roles_to_remove) {
          try {
            await member.roles.remove(roleId);
            rolesRemoved.push(`<@&${roleId}>`);
          } catch (err) {
            failures.push(`Failed to remove <@&${roleId}>`);
          }
        }
      }

      let nicknameChanged = false;
      if (result.new_nickname !== null) {
        try {
          await member.setNickname(result.new_nickname);
          nicknameChanged = true;
        } catch (err) {
          failures.push("Failed to update nickname");
        }
      }

      const auditEmbed = createBaseEmbed(
        "Auto-Verification (Join)",
        `Auto-verification processed for new member <@${member.id}>`,
        failures.length > 0 ? EMBED_COLORS.WARNING : EMBED_COLORS.SUCCESS,
      );

      if (rolesAdded.length > 0) {
        auditEmbed.addFields({ name: "Roles Added", value: rolesAdded.join(", ") });
      }
      if (rolesRemoved.length > 0) {
        auditEmbed.addFields({ name: "Roles Removed", value: rolesRemoved.join(", ") });
      }
      if (nicknameChanged && result.new_nickname !== null) {
        auditEmbed.addFields({
          name: "Nickname Updated",
          value: result.new_nickname ? `\`${result.new_nickname}\`` : "*Cleared*",
        });
      }
      if (failures.length > 0) {
        auditEmbed.addFields({ name: "Failures / Warnings", value: failures.join("\n") });
      }

      await sendGuildAuditLog(member.client, guildId, auditEmbed);
    } catch (error) {
      logger.error(`Error in guildMemberAdd auto-verification for member ${member.id}:`, error);
    }
  },
};
