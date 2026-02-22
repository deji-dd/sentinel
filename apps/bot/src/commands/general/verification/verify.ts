import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
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
  supabase: SupabaseClient,
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

    // Get guild config and API key(s)
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
        "Verify Failed: Not Configured",
        configError?.message || "Missing guild config",
        `${interaction.user} attempted /verify but guild is not configured.`,
      );
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Not Configured")
        .setDescription(
          "This guild has not configured an API key. Ask an admin to run `/config` to set this up.",
        );

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
        "Verify Warning: API Key Required",
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

    const apiKey = getNextApiKey(guildId, apiKeys);

    // Call Torn API to check user's Discord linkage and faction
    let response;
    try {
      response = await botTornApi.get("/user", {
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
          supabase,
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
        supabase,
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

    // At this point, response is definitely assigned and typed correctly
    if (!response) return;

    // Success - user is linked with faction info
    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Verified")
      .setDescription(`**${response.profile?.name}** is verified`)
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
    await supabase.from(TABLE_NAMES.VERIFIED_USERS).upsert({
      discord_id: targetUser.id,
      torn_player_id: response.profile?.id,
      torn_player_name: response.profile?.name,
      faction_id: response.faction?.id || null,
      faction_name: response.faction?.name || null,
      verified_at: new Date().toISOString(),
    });

    // Apply nickname template
    if (interaction.guild) {
      try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        const nickname = guildConfig.nickname_template
          .replace("{name}", response.profile?.name || "")
          .replace("{id}", (response.profile?.id || "").toString())
          .replace("{tag}", response.faction?.tag || "");

        await member.setNickname(nickname);
      } catch (nicknameError) {
        console.error("Failed to set nickname:", nicknameError);
        // Don't fail verification if nickname update fails
      }
    }

    // Assign verification role if configured
    const rolesAdded: string[] = [];
    const rolesFailed: string[] = [];

    if (guildConfig.verified_role_id && interaction.guild) {
      try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        // Check if member already has the role
        if (!member.roles.cache.has(guildConfig.verified_role_id)) {
          await member.roles.add(guildConfig.verified_role_id);
          rolesAdded.push(guildConfig.verified_role_id);
        }
      } catch (roleError) {
        console.error("Failed to assign verification role:", roleError);
        rolesFailed.push(guildConfig.verified_role_id);
      }
    }

    // Check for faction role mapping and assign if exists
    if (response.faction?.id && interaction.guild) {
      const { data: factionRole } = await supabase
        .from(TABLE_NAMES.FACTION_ROLES)
        .select("role_ids")
        .eq("guild_id", interaction.guildId)
        .eq("faction_id", response.faction.id)
        .single();

      if (factionRole && factionRole.role_ids.length > 0) {
        try {
          const member = await interaction.guild.members.fetch(targetUser.id);
          for (const roleId of factionRole.role_ids) {
            if (!member.roles.cache.has(roleId)) {
              await member.roles.add(roleId);
              rolesAdded.push(roleId);
            }
          }
        } catch (roleError) {
          console.error("Failed to assign roles:", roleError);
          // Track failed faction roles
          for (const roleId of factionRole.role_ids) {
            rolesFailed.push(roleId);
          }
          successEmbed.setFooter({
            text: "Verified but failed to assign some roles (check bot permissions)",
          });
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
      supabase,
      "Verify Success",
      `${targetUser} verified as **${response.profile?.name}**.`,
      logFields,
    );

    if (!successEmbed.data.footer) {
      successEmbed.setFooter({
        text: "Use /config to manage verification and faction role assignments",
      });
    }

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
