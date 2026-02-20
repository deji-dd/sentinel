import {
  CommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";
import { decrypt } from "../../lib/encryption.js";
import { botTornApi } from "../../lib/torn-api.js";

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
      });
      return;
    }

    // Get guild config with API key
    const { data: guildConfig, error: configError } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("api_key, nickname_template")
      .eq("guild_id", guildId)
      .single();

    if (configError || !guildConfig) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Guild Not Configured")
        .setDescription("This guild has not been configured yet.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    if (!guildConfig.api_key) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ API Key Required")
        .setDescription(
          "An API key must be set before verifying users. Use `/config` to set one.",
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
    } catch {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Decryption Error")
        .setDescription("Failed to decrypt API key.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Fetch all guild members
    const guild = interaction.guild;
    if (!guild) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("Unable to fetch guild information.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Fetch all members (may require guild member intent)
    const members = await guild.members.fetch();
    const results: VerificationResult[] = [];

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
        // Call Torn API to verify
        const response = await botTornApi.get(`/user/${member.id}`, {
          apiKey,
          queryParams: { selections: "discord,faction" },
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
            tornId: response.player_id,
            tornName: response.name,
            factionName: response.faction?.faction_name || "None",
          });

          // Store in database
          await supabase.from(TABLE_NAMES.VERIFIED_USERS).upsert({
            discord_id: member.id,
            torn_player_id: response.player_id,
            torn_player_name: response.name,
            faction_id: response.faction?.faction_id || null,
            faction_name: response.faction?.faction_name || null,
            verified_at: new Date().toISOString(),
          });

          // Apply nickname template
          try {
            const nickname = guildConfig.nickname_template
              .replace("{name}", response.name)
              .replace("{id}", response.player_id.toString())
              .replace("{tag}", response.faction?.faction_tag || "");

            await member.setNickname(nickname);
          } catch (nicknameError) {
            console.error(
              `Failed to set nickname for ${member.user.username}:`,
              nicknameError,
            );
          }

          // Assign faction role if mapping exists
          if (response.faction?.faction_id) {
            const { data: factionRole } = await supabase
              .from(TABLE_NAMES.FACTION_ROLES)
              .select("role_ids")
              .eq("guild_id", guildId)
              .eq("faction_id", response.faction.faction_id)
              .single();

            if (factionRole && factionRole.role_ids.length > 0) {
              try {
                await member.roles.add(factionRole.role_ids);
              } catch (roleError) {
                console.error(
                  `Failed to assign roles to ${member.user.username}:`,
                  roleError,
                );
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

    await interaction.editReply({ embeds: [resultEmbed] });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in verifyall command:", errorMsg);

    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Command Error")
      .setDescription(errorMsg);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed] });
    } else {
      await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }
}
