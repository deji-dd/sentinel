import {
  CommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";
import { botTornApi } from "../../../lib/torn-api.js";
import {
  getNextApiKey,
  resolveApiKeysForGuild,
} from "../../../lib/api-keys.js";
import {
  logGuildError,
  logGuildSuccess,
  logGuildWarning,
} from "../../../lib/guild-logger.js";

export const data = new SlashCommandBuilder()
  .setName("verifyall")
  .setDescription("Re-verify all members in the guild")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

interface VerificationResult {
  userId: string;
  username: string;
  status: "success" | "not_linked" | "error";
  tornId?: number;
  tornName?: string;
  factionName?: string;
  rolesAdded?: string[];
  rolesFailed?: string[];
  errorMessage?: string;
}

export async function execute(
  interaction: CommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("Unable to determine guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Get guild config with API key(s)
    const { data: guildConfig, error: configError } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("api_keys, api_key, nickname_template, verified_role_id")
      .eq("guild_id", guildId)
      .single();

    if (configError || !guildConfig) {
      await logGuildError(
        guildId,
        interaction.client,
        supabase,
        "Verify All Failed: Not Configured",
        configError?.message || "Missing guild config",
        `${interaction.user} attempted /verifyall but guild is not configured.`,
      );
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Guild Not Configured")
        .setDescription("This guild has not been configured yet.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    const { keys: apiKeys, error: apiKeyError } = resolveApiKeysForGuild(
      guildId,
      guildConfig,
    );

    if (apiKeyError) {
      await logGuildWarning(
        guildId,
        interaction.client,
        supabase,
        "Verify All Warning: API Key Required",
        apiKeyError,
        [{ name: "User", value: interaction.user.toString(), inline: true }],
      );
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ API Key Required")
        .setDescription(apiKeyError);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Fetch all guild members
    const guild = interaction.guild;
    if (!guild) {
      await logGuildError(
        guildId,
        interaction.client,
        supabase,
        "Verify All Failed",
        "Unable to fetch guild information",
        `Guild not available for ${interaction.user}.`,
      );
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("Unable to fetch guild information.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Fetch all members (may require guild member intent)
    const members = await guild.members.fetch();
    const results: VerificationResult[] = [];

    await logGuildSuccess(
      guildId,
      interaction.client,
      supabase,
      "Verify All Started",
      `${interaction.user} started verification for ${members.size} members.`,
    );

    let processed = 0;
    const total = members.size;

    // Send initial progress embed
    const progressEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("🔄 Verification in Progress")
      .setDescription(`Processing 0/${total} members...`);

    await interaction.editReply({ embeds: [progressEmbed] });

    // Process each member
    for (const [, member] of members) {
      // Skip bots
      if (member.user.bot) {
        processed++;
        continue;
      }

      try {
        const apiKey = getNextApiKey(guildId, apiKeys);
        // Call Torn API to verify
        const response: any = await botTornApi.getRaw("/user", apiKey, {
          selections: "discord,faction,profile",
          id: member.id,
        });

        if (response.error) {
          if (response.error.code === 6) {
            // User not linked to Torn
            results.push({
              userId: member.id,
              username: member.user.username,
              status: "not_linked",
            });
          } else {
            results.push({
              userId: member.id,
              username: member.user.username,
              status: "error",
              errorMessage: response.error.error,
            });
          }
        } else if (response.discord) {
          // Successfully verified
          results.push({
            userId: member.id,
            username: member.user.username,
            status: "success",
            tornId: response.profile?.id,
            tornName: response.profile?.name,
            factionName: response.faction?.name || "None",
            rolesAdded: [],
            rolesFailed: [],
          });

          // Store in database
          await supabase.from(TABLE_NAMES.VERIFIED_USERS).upsert({
            discord_id: member.id,
            torn_player_id: response.profile?.id,
            torn_player_name: response.profile?.name,
            faction_id: response.faction?.id || null,
            faction_name: response.faction?.name || null,
            verified_at: new Date().toISOString(),
          });

          // Apply nickname template
          try {
            const nickname = guildConfig.nickname_template
              .replace("{name}", response.profile?.name || "")
              .replace("{id}", (response.profile?.id || "").toString())
              .replace("{tag}", response.faction?.tag || "");

            await member.setNickname(nickname);
          } catch (nicknameError) {
            console.error(
              `Failed to set nickname for ${member.user.username}:`,
              nicknameError,
            );
          }

          // Assign verification role if configured
          if (guildConfig.verified_role_id) {
            try {
              if (!member.roles.cache.has(guildConfig.verified_role_id)) {
                await member.roles.add(guildConfig.verified_role_id);
                const result = results[results.length - 1];
                result.rolesAdded!.push(guildConfig.verified_role_id);
              }
            } catch (roleError) {
              console.error(
                `Failed to assign verification role to ${member.user.username}:`,
                roleError,
              );
              const result = results[results.length - 1];
              result.rolesFailed!.push(guildConfig.verified_role_id);
            }
          }

          // Assign faction role if mapping exists
          if (response.faction?.id) {
            const { data: factionRole } = await supabase
              .from(TABLE_NAMES.FACTION_ROLES)
              .select("role_ids")
              .eq("guild_id", guildId)
              .eq("faction_id", response.faction.id)
              .single();

            if (factionRole && factionRole.role_ids.length > 0) {
              try {
                const result = results[results.length - 1];
                for (const roleId of factionRole.role_ids) {
                  if (!member.roles.cache.has(roleId)) {
                    await member.roles.add(roleId);
                    result.rolesAdded!.push(roleId);
                  }
                }
              } catch (roleError) {
                console.error(
                  `Failed to assign faction roles to ${member.user.username}:`,
                  roleError,
                );
                const result = results[results.length - 1];
                for (const roleId of factionRole.role_ids) {
                  result.rolesFailed!.push(roleId);
                }
              }
            }
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({
          userId: member.id,
          username: member.user.username,
          status: "error",
          errorMessage: errorMsg,
        });
      }

      processed++;

      // Update progress every 5 members or on last member
      if (processed % 5 === 0 || processed === total) {
        const updateEmbed = new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle("🔄 Verification in Progress")
          .setDescription(`Processing ${processed}/${total} members...`);

        await interaction.editReply({ embeds: [updateEmbed] });
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Compile results
    const successful = results.filter((r) => r.status === "success").length;
    const notLinked = results.filter((r) => r.status === "not_linked").length;
    const errors = results.filter((r) => r.status === "error").length;

    const resultEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Verification Complete")
      .setDescription(
        `**Total Members:** ${total}\n` +
          `**Verified:** ${successful}\n` +
          `**Not Linked:** ${notLinked}\n` +
          `**Errors:** ${errors}`,
      )
      .setFooter({
        text: "Verification results saved to database",
      });

    // Add not linked details if any
    if (notLinked > 0) {
      const notLinkedUsers = results
        .filter((r) => r.status === "not_linked")
        .map((r) => `- ${r.username}`)
        .slice(0, 10)
        .join("\n");

      resultEmbed.addFields({
        name: "Not Linked to Torn",
        value:
          notLinkedUsers +
          (notLinked > 10 ? `\n...and ${notLinked - 10} more` : ""),
        inline: false,
      });
    }

    // Add error details if any
    if (errors > 0) {
      const errorUsers = results
        .filter((r) => r.status === "error")
        .map((r) => `- ${r.username}: ${r.errorMessage}`)
        .slice(0, 5)
        .join("\n");

      resultEmbed.addFields({
        name: "Errors",
        value: errorUsers + (errors > 5 ? `\n...and ${errors - 5} more` : ""),
        inline: false,
      });
    }

    // Add role assignment summary
    const totalRolesAdded = results.reduce(
      (sum, r) => sum + (r.rolesAdded?.length || 0),
      0,
    );
    const totalRolesFailed = results.reduce(
      (sum, r) => sum + (r.rolesFailed?.length || 0),
      0,
    );

    if (totalRolesAdded > 0 || totalRolesFailed > 0) {
      let rolesSummary = "";
      if (totalRolesAdded > 0)
        rolesSummary += `✅ **${totalRolesAdded}** roles added\n`;
      if (totalRolesFailed > 0)
        rolesSummary += `❌ **${totalRolesFailed}** roles failed to assign`;
      resultEmbed.addFields({
        name: "Role Assignment",
        value: rolesSummary,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [resultEmbed], components: [] });

    if (errors > 0) {
      await logGuildError(
        guildId,
        interaction.client,
        supabase,
        "Verify All Completed with Errors",
        `${errors} error(s) occurred during verification.`,
        `Verified: ${successful}, Not Linked: ${notLinked}, Errors: ${errors}.`,
      );
    } else if (notLinked > 0) {
      await logGuildWarning(
        guildId,
        interaction.client,
        supabase,
        "Verify All Completed",
        `Verified: ${successful}, Not Linked: ${notLinked}.`,
      );
    } else {
      await logGuildSuccess(
        guildId,
        interaction.client,
        supabase,
        "Verify All Completed",
        `Verified: ${successful}, Not Linked: ${notLinked}, Errors: ${errors}.`,
      );
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in verifyall command:", errorMsg);

    if (interaction.guildId) {
      await logGuildError(
        interaction.guildId,
        interaction.client,
        supabase,
        "Verify All Command Error",
        errorMsg,
        `Error running /verifyall for ${interaction.user}.`,
      );
    }

    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Command Error")
      .setDescription(errorMsg);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed], components: [] });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
        components: [],
        ephemeral: true,
      });
    }
  }
}
