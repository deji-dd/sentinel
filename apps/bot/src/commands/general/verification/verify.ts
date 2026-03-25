import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { TABLE_NAMES, getNextApiKey } from "@sentinel/shared";
import { type TornApiComponents } from "@sentinel/shared";
import { db } from "../../../lib/db-client.js";
import { getGuildApiKeys } from "../../../lib/guild-api-keys.js";
import {
  logGuildError,
  logGuildSuccess,
  logGuildWarning,
} from "../../../lib/guild-logger.js";
import { upsertVerifiedUser } from "../../../lib/verified-users.js";
import { tornApi } from "../../../services/torn-client.js";

type UserGenericResponse = TornApiComponents["schemas"]["UserDiscordResponse"] &
  TornApiComponents["schemas"]["UserFactionResponse"] &
  TornApiComponents["schemas"]["UserProfileResponse"];

function parseTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === "string",
        );
      }
    } catch {
      return [];
    }
  }

  return [];
}

export const data = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Verify a Discord user's Torn City account connection")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("User to verify (defaults to you)")
      .setRequired(false),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser("user") || interaction.user;
    const guildId = interaction.guildId;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("This command can only be used in a guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Get guild config for settings (nickname template, verified role)
    const guildConfig = (await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .select(["nickname_template", "verified_role_id", "verified_role_ids"])
      .where("guild_id", "=", guildId)
      .limit(1)
      .executeTakeFirst()) as
      | {
          nickname_template: string | null;
          verified_role_id: string | null;
          verified_role_ids: string | null;
        }
      | undefined;

    if (!guildConfig) {
      await logGuildError(
        guildId,
        interaction.client,
        "Verify Failed: Not Configured",
        "Missing guild config",
        `${interaction.user} attempted /verify but guild is not configured.`,
      );
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Not Configured")
        .setDescription(
          "This guild has not been configured yet. Ask an admin to set up the guild first.",
        );

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

        "Verify Warning: API Key Required",
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

    const apiKey = getNextApiKey(guildId, apiKeys);

    // Call Torn API to check user's Discord linkage and faction
    let response: UserGenericResponse;
    try {
      response = await tornApi.get<UserGenericResponse>("/user", {
        apiKey,
        queryParams: {
          selections: ["discord", "faction", "profile"],
          id: targetUser.id,
        },
      });
    } catch (apiError) {
      const errorMessage =
        apiError instanceof Error ? apiError.message : String(apiError);

      // Map error codes to user-friendly messages
      if (errorMessage.includes("Incorrect ID")) {
        await logGuildWarning(
          guildId,
          interaction.client,

          "Verify: Not Linked",
          `${targetUser} is not linked to Torn.`,
          [{ name: "Target", value: targetUser.toString(), inline: true }],
        );
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Not Linked")
          .setDescription(
            `${targetUser.username} has not linked their Discord account to Torn City yet.`,
          );

        await interaction.editReply({
          embeds: [errorEmbed],
          components: [],
        });
        return;
      }

      // Handle other API errors
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription(errorMessage || "Failed to verify user.");

      await logGuildError(
        guildId,
        interaction.client,

        "Verify Failed",
        errorMessage || "Failed to verify user.",
        `Verification failed for ${targetUser}.`,
      );

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Success - user is linked with faction info
    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Verified")
      .setDescription(`${targetUser} is verified.`)
      .addFields({
        name: "Torn ID",
        value: String(response.profile?.id || "Unknown"),
        inline: true,
      });

    // We'll update this after we track roles below
    let logFields: Array<{ name: string; value: string; inline: boolean }> = [
      {
        name: "Torn ID",
        value: String(response.profile?.id || "Unknown"),
        inline: true,
      },
    ];

    if (response.faction) {
      successEmbed.addFields({
        name: "Faction",
        value: response.faction.name,
        inline: true,
      });
    }

    // Store verification in database
    await upsertVerifiedUser({
      discordId: targetUser.id,
      tornId: response.profile?.id,
      tornName: response.profile?.name || "Unknown",
      factionId: response.faction?.id || null,
      factionTag: response.faction?.tag || null,
    });

    // Apply nickname template
    if (interaction.guild) {
      try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        const nickname = (guildConfig.nickname_template || "{name} [{id}]")
          .replace("{name}", response.profile?.name || "")
          .replace("{id}", (response.profile?.id || "").toString())
          .replace("{tag}", response.faction?.tag || "");

        await member.setNickname(nickname);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (nicknameError) {
        // Silently ignore nickname errors (expected for admins with higher perms)
        // Don't fail verification if nickname update fails
      }
    }

    // Assign verification role if configured
    const rolesAdded: string[] = [];
    const rolesRemoved: string[] = [];
    const rolesFailed: string[] = [];

    const rolesToAssign = new Set<string>();
    if (guildConfig.verified_role_id) rolesToAssign.add(guildConfig.verified_role_id);
    const multiVerifiedRoleIds = parseTextArray(guildConfig.verified_role_ids);
    multiVerifiedRoleIds.forEach((id) => rolesToAssign.add(id));

    if (rolesToAssign.size > 0 && interaction.guild) {
      try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        for (const roleId of rolesToAssign) {
          if (!member.roles.cache.has(roleId)) {
            try {
              await member.roles.add(roleId);
              rolesAdded.push(roleId);
            } catch (roleError) {
              console.error(`Failed to assign verified role ${roleId}:`, roleError);
              rolesFailed.push(roleId);
            }
          }
        }
      } catch (fetchError) {
        console.error("Failed to fetch member for role assignment:", fetchError);
      }
    }

    // Handle faction roles - WITH STRICT ROLE SECURITY
    // Treat faction roles as "master" - only people in that faction can have those roles
    if (interaction.guild) {
      const member = await interaction.guild.members.fetch(targetUser.id);

      // Fetch ALL faction role mappings for this guild
      const allFactionMappings = (
        await db
          .selectFrom(TABLE_NAMES.FACTION_ROLES)
          .select([
            "faction_id",
            "member_role_ids",
            "leader_role_ids",
            "enabled",
          ])
          .where("guild_id", "=", interaction.guildId)
          .execute()
      ).map((row) => {
        const typed = row as {
          faction_id: number;
          member_role_ids: unknown;
          leader_role_ids: unknown;
          enabled: unknown;
        };

        return {
          faction_id: typed.faction_id,
          member_role_ids: parseTextArray(typed.member_role_ids),
          leader_role_ids: parseTextArray(typed.leader_role_ids),
          enabled:
            typed.enabled !== false &&
            typed.enabled !== 0 &&
            typed.enabled !== "0",
        };
      });

      if (allFactionMappings && allFactionMappings.length > 0) {
        const enabledMappings = allFactionMappings.filter(
          (m) => m.enabled !== false,
        );

        // Determine which roles user SHOULD have (based on their faction)
        const rolesUserShouldHave = new Set<string>();

        // Add roles if they're in the mapped faction
        if (response.faction?.id) {
          const currentFactionMapping = enabledMappings.find(
            (m) => m.faction_id === response.faction!.id,
          );

          if (currentFactionMapping) {
            // Add member roles
            currentFactionMapping.member_role_ids?.forEach((roleId: string) => {
              rolesUserShouldHave.add(roleId);
            });

            // Check if user is a leader and add leader roles
            if (
              currentFactionMapping.leader_role_ids &&
              currentFactionMapping.leader_role_ids.length > 0
            ) {
              try {
                const membersResponse = await tornApi.get(
                  "/faction/{id}/members",
                  {
                    apiKey,
                    pathParams: { id: response.faction.id },
                  },
                );

                const members = membersResponse.members || [];
                const factionMember = members.find(
                  (m) => m.id === response.profile?.id,
                );

                if (
                  factionMember &&
                  (factionMember.position === "Leader" ||
                    factionMember.position === "Co-leader")
                ) {
                  currentFactionMapping.leader_role_ids.forEach(
                    (roleId: string) => {
                      rolesUserShouldHave.add(roleId);
                    },
                  );
                }
              } catch (leaderCheckError) {
                console.error(
                  "Failed to check leader status:",
                  leaderCheckError,
                );
                // Continue with member roles only
              }
            }
          }
        }

        // Now enforce role state: remove all faction-mapped roles that user shouldn't have
        // This ensures roles as "master" - no one can manually keep a role they shouldn't have
        for (const mapping of enabledMappings) {
          const allMappedRoles = [
            ...(mapping.member_role_ids || []),
            ...(mapping.leader_role_ids || []),
          ];

          for (const roleId of allMappedRoles) {
            const userHasRole = member.roles.cache.has(roleId);
            const userShouldHaveRole = rolesUserShouldHave.has(roleId);

            if (userHasRole && !userShouldHaveRole) {
              // User has a role they shouldn't - remove it
              try {
                await member.roles.remove(roleId);
                rolesRemoved.push(roleId);
              } catch (removeError) {
                console.error("Failed to remove role:", removeError);
              }
            } else if (!userHasRole && userShouldHaveRole) {
              // User should have a role - add it
              try {
                await member.roles.add(roleId);
                rolesAdded.push(roleId);
              } catch (addError) {
                console.error("Failed to add role:", addError);
                rolesFailed.push(roleId);
              }
            }
          }
        }
      }
    }

    // Show newly added roles if any
    if (rolesAdded.length > 0) {
      const rolesMention = rolesAdded
        .map((roleId: string) => `<@&${roleId}>`)
        .join(", ");
      successEmbed.addFields({
        name: "✅ Roles Added",
        value: rolesMention,
        inline: true,
      });
      logFields.push({
        name: "✅ Roles Added",
        value: rolesMention,
        inline: false,
      });
    }

    // Show removed roles if any
    if (rolesRemoved.length > 0) {
      const rolesMention = rolesRemoved
        .map((roleId: string) => `<@&${roleId}>`)
        .join(", ");
      successEmbed.addFields({
        name: "🗑️ Roles Removed",
        value: rolesMention,
        inline: true,
      });
      logFields.push({
        name: "🗑️ Roles Removed",
        value: rolesMention,
        inline: false,
      });
    }

    // Show failed roles if any
    if (rolesFailed.length > 0) {
      const rolesMention = rolesFailed
        .map((roleId: string) => `<@&${roleId}>`)
        .join(", ");
      successEmbed.addFields({
        name: "❌ Failed to Assign",
        value: rolesMention,
        inline: true,
      });
      logFields.push({
        name: "❌ Roles Failed",
        value: rolesMention,
        inline: false,
      });
    }

    // Now log to guild with role information
    await logGuildSuccess(
      guildId,
      interaction.client,

      "Verify Success",
      `${targetUser} verified as **${response.profile?.name}**.`,
      logFields,
    );

    await interaction.editReply({
      embeds: [successEmbed],
      components: [],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in verify command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
      components: [],
    });
  }
}
