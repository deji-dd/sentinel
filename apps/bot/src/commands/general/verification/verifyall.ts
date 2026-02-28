import {
  CommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import {
  TABLE_NAMES,
  getNextApiKey,
  type TornApiComponents,
} from "@sentinel/shared";
import { getGuildApiKeys } from "../../../lib/guild-api-keys.js";
import {
  logGuildError,
  logGuildSuccess,
  logGuildWarning,
} from "../../../lib/guild-logger.js";
import { tornApi } from "../../../services/torn-client.js";
import { supabase } from "../../../lib/supabase.js";

type UserGenericResponse = TornApiComponents["schemas"]["UserDiscordResponse"] &
  TornApiComponents["schemas"]["UserFactionResponse"] &
  TornApiComponents["schemas"]["UserProfileResponse"];

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

export async function execute(interaction: CommandInteraction): Promise<void> {
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

    // Get guild config with settings
    const { data: guildConfig, error: configError } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("nickname_template, verified_role_id")
      .eq("guild_id", guildId)
      .single();

    if (configError || !guildConfig) {
      await logGuildError(
        guildId,
        interaction.client,

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

    // Get guild API keys from new table
    const apiKeys = await getGuildApiKeys(guildId);

    if (apiKeys.length === 0) {
      await logGuildWarning(
        guildId,
        interaction.client,

        "Verify All Warning: API Key Required",
        "No API keys configured for guild",
        [{ name: "User", value: interaction.user.toString(), inline: true }],
      );
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ API Key Required")
        .setDescription(
          "This guild has no API keys configured. Guild members need to add their API keys for verification to work.",
        );

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

    // Fetch faction role mappings and cache faction leaders
    const { data: factionMappings } = await supabase
      .from(TABLE_NAMES.FACTION_ROLES)
      .select("*")
      .eq("guild_id", guildId);

    // Cache faction members for leader detection
    // Map: factionId -> Set of leader player IDs
    const factionLeadersCache = new Map<number, Set<number>>();

    // Fetch faction members for all mapped factions that are enabled and have leader roles
    if (factionMappings && factionMappings.length > 0) {
      const enabledMappings = factionMappings.filter(
        (m) =>
          m.enabled !== false &&
          m.leader_role_ids &&
          m.leader_role_ids.length > 0,
      );

      for (const mapping of enabledMappings) {
        try {
          const apiKey = getNextApiKey(guildId, apiKeys);
          const membersResponse = await tornApi.get("/faction/{id}/members", {
            apiKey,
            pathParams: { id: mapping.faction_id },
          });

          const leaders = new Set<number>();
          const members = membersResponse.members;

          // members is already an array, iterate directly
          for (const member of members) {
            if (
              member.position === "Leader" ||
              member.position === "Co-leader"
            ) {
              leaders.add(member.id);
            }
          }

          factionLeadersCache.set(mapping.faction_id, leaders);

          // Rate limiting delay
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(
            `Error fetching faction ${mapping.faction_id} members: ${msg}`,
          );
        }
      }
    }

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
        const response = await tornApi.get<UserGenericResponse>("/user", {
          apiKey,
          queryParams: {
            selections: ["discord", "faction", "profile"],
            id: member.id,
          },
        });

        if (response.discord) {
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
            torn_id: response.profile?.id,
            torn_name: response.profile?.name,
            faction_id: response.faction?.id || null,
            faction_tag: response.faction?.tag || null,
            updated_at: new Date().toISOString(),
          });

          // Apply nickname template
          try {
            const nickname = guildConfig.nickname_template
              .replace("{name}", response.profile?.name || "")
              .replace("{id}", (response.profile?.id || "").toString())
              .replace("{tag}", response.faction?.tag || "");

            await member.setNickname(nickname);
          } catch (nicknameError) {
            // Silently ignore nickname errors (expected for admins with higher perms)
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
              .select("member_role_ids, leader_role_ids, enabled")
              .eq("guild_id", guildId)
              .eq("faction_id", response.faction.id)
              .single();

            if (factionRole && factionRole.enabled !== false) {
              const rolesToAssign = [...(factionRole.member_role_ids || [])];

              // Check if user is a leader and add leader roles
              if (
                factionRole.leader_role_ids &&
                factionRole.leader_role_ids.length > 0 &&
                response.profile?.id
              ) {
                const leaders = factionLeadersCache.get(response.faction.id);
                if (leaders && leaders.has(response.profile.id)) {
                  rolesToAssign.push(...factionRole.leader_role_ids);
                }
              }

              if (rolesToAssign.length > 0) {
                try {
                  const result = results[results.length - 1];
                  for (const roleId of rolesToAssign) {
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
                  for (const roleId of rolesToAssign) {
                    result.rolesFailed!.push(roleId);
                  }
                }
              }
            }
          }

          // Log individual verification success
          const result = results[results.length - 1];
          const logFields: Array<{
            name: string;
            value: string;
            inline: boolean;
          }> = [
            {
              name: "Torn ID",
              value: String(response.profile?.id || "Unknown"),
              inline: true,
            },
          ];

          if (response.faction) {
            logFields.push({
              name: "Faction",
              value: response.faction.name,
              inline: true,
            });
          }

          if (result.rolesAdded && result.rolesAdded.length > 0) {
            const rolesMention = result.rolesAdded
              .map((roleId) => `<@&${roleId}>`)
              .join(", ");
            logFields.push({
              name: "✅ Roles Added",
              value: rolesMention,
              inline: false,
            });
          }

          if (result.rolesFailed && result.rolesFailed.length > 0) {
            const rolesMention = result.rolesFailed
              .map((roleId) => `<@&${roleId}>`)
              .join(", ");
            logFields.push({
              name: "❌ Roles Failed",
              value: rolesMention,
              inline: false,
            });
          }

          await logGuildSuccess(
            guildId,
            interaction.client,
            "Verify All Success",
            `${member.user} verified as **${response.profile?.name}**.`,
            logFields,
          );
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isNotLinked = /Incorrect ID/i.test(errorMsg);

        if (isNotLinked) {
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
            errorMessage: errorMsg,
          });
        }
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

    // Only log errors/warnings, not success summary (individual verifications already logged)
    if (errors > 0) {
      await logGuildError(
        guildId,
        interaction.client,
        "Verify All Completed with Errors",
        `${errors} error(s) occurred during verification.`,
        `Verified: ${successful}, Not Linked: ${notLinked}, Errors: ${errors}.`,
      );
    } else if (notLinked > 0) {
      await logGuildWarning(
        guildId,
        interaction.client,
        "Verify All: Users Not Linked",
        `${notLinked} user(s) not linked to Torn.`,
      );
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in verifyall command:", errorMsg);

    if (interaction.guildId) {
      await logGuildError(
        interaction.guildId,
        interaction.client,

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
