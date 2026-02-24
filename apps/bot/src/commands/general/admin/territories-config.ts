/**
 * TT Module Config Command
 * View and manage territories module configuration
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";

export const data = new SlashCommandBuilder()
  .setName("territories-config")
  .setDescription("View and manage TT module configuration for this guild");

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply({ ephemeral: true });

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

    // Get TT config
    const { data: ttConfig, error: configError } = await supabase
      .from(TABLE_NAMES.TT_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

    if (configError || !ttConfig) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ TT Module Not Configured")
        .setDescription(
          "Please run **/territories-setup** first to configure the TT module.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Build config display
    const typeLabels: Record<string, string> = {
      all: "All Changes",
      territories: "Specific Territories",
      factions: "Specific Factions",
      combined: "Combined (Territories OR Factions)",
    };

    const configEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("⚙️ TT Module Configuration")
      .addFields(
        {
          name: "Notification Type",
          value: `**${typeLabels[ttConfig.notification_type]}**`,
          inline: true,
        },
        {
          name: "Monitored Territories",
          value:
            ttConfig.territory_ids && ttConfig.territory_ids.length > 0
              ? ttConfig.territory_ids.join(", ")
              : "None configured",
          inline: true,
        },
        {
          name: "Monitored Factions",
          value:
            ttConfig.faction_ids && ttConfig.faction_ids.length > 0
              ? ttConfig.faction_ids.map(String).join(", ")
              : "None configured",
          inline: true,
        },
      )
      .setFooter({
        text: "Use /territories-setup to modify settings",
      });

    // Add helpful info based on notification type
    if (
      ttConfig.notification_type === "territories" &&
      (!ttConfig.territory_ids || ttConfig.territory_ids.length === 0)
    ) {
      configEmbed.addFields({
        name: "⚠️ Warning",
        value:
          "You have **Specific Territories** selected but no territories are configured. You won't receive any notifications.",
      });
    }

    if (
      ttConfig.notification_type === "factions" &&
      (!ttConfig.faction_ids || ttConfig.faction_ids.length === 0)
    ) {
      configEmbed.addFields({
        name: "⚠️ Warning",
        value:
          "You have **Specific Factions** selected but no factions are configured. You won't receive any notifications.",
      });
    }

    if (ttConfig.notification_type === "combined") {
      if (
        (!ttConfig.territory_ids || ttConfig.territory_ids.length === 0) &&
        (!ttConfig.faction_ids || ttConfig.faction_ids.length === 0)
      ) {
        configEmbed.addFields({
          name: "⚠️ Warning",
          value:
            "You have **Combined** mode but no territories or factions are configured. You won't receive any notifications.",
        });
      }
    }

    await interaction.editReply({
      embeds: [configEmbed],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in territories-config command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
