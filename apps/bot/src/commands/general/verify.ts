import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";
import { botTornApi } from "../../lib/torn-api.js";
import { decrypt } from "../../lib/encryption.js";

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
      });
      return;
    }

    // Get guild config and API key
    const { data: guildConfig, error: configError } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("api_key, nickname_template")
      .eq("guild_id", guildId)
      .single();

    if (configError || !guildConfig?.api_key) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Not Configured")
        .setDescription(
          "This guild has not configured an API key. Ask an admin to run `/config` to set this up.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Decrypt the API key
    let apiKey: string;
    try {
      apiKey = decrypt(guildConfig.api_key);
    } catch (error) {
      console.error("Failed to decrypt API key:", error);
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription(
          "Failed to decrypt API key. Please contact the bot owner.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Call Torn API to check user's Discord linkage and faction
    const response = await botTornApi.get<{
      profile?: {
        id: number;
        name: string;
      };
      faction?: {
        id: number;
        name: string;
      };
      error?: {
        code: number;
        error: string;
      };
    }>(`/user/${targetUser.id}`, {
      apiKey,
      queryParams: {
        selections: "discord,faction",
      },
    });

    // Handle API errors
    if (response.error) {
      const errorCode = response.error.code;

      if (errorCode === 6) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Not Linked")
          .setDescription(
            `${targetUser.username} has not linked their Discord account to Torn City yet.`,
          );

        await interaction.editReply({
          embeds: [errorEmbed],
        });
        return;
      }

      // Handle other API errors
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription(response.error.error || "Failed to verify user.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

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
          .replace("{tag}", ""); // Tag not available in this API response

        await member.setNickname(nickname);
      } catch (nicknameError) {
        console.error("Failed to set nickname:", nicknameError);
        // Don't fail verification if nickname update fails
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
          await member.roles.add(factionRole.role_ids);
          const rolesMention = factionRole.role_ids
            .map((roleId: string) => `<@&${roleId}>`)
            .join(", ");
          successEmbed.addFields({
            name: "Roles Assigned",
            value: rolesMention,
            inline: true,
          });
        } catch (roleError) {
          console.error("Failed to assign roles:", roleError);
          successEmbed.setFooter({
            text: "Verified but failed to assign roles (check bot permissions)",
          });
        }
      }
    }

    if (!successEmbed.data.footer) {
      successEmbed.setFooter({
        text: "Use /config to manage faction role assignments",
      });
    }

    await interaction.editReply({
      embeds: [successEmbed],
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
    });
  }
}
