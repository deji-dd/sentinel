/**
 * TT Module Setup Command
 * Configure territories module for guild-specific notifications
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";

export const data = new SlashCommandBuilder()
  .setName("territories-setup")
  .setDescription("Configure TT module notifications for this guild");

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply();

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

    // Check if guild config exists
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("guild_id")
      .eq("guild_id", guildId)
      .single();

    if (!guildConfig) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Guild Not Configured")
        .setDescription("Please run /setup-guild first in the admin guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Check if TT config exists, create if not
    const { data: ttConfig } = await supabase
      .from(TABLE_NAMES.TT_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

    if (!ttConfig) {
      // Create default TT config
      await supabase.from(TABLE_NAMES.TT_CONFIG).insert({
        guild_id: guildId,
        notification_type: "all",
        territory_ids: [],
        faction_ids: [],
      });
    }

    // Show notification type options
    const notificationTypes = [
      {
        label: "All Changes",
        value: "all",
        description: "Notify on all territory ownership changes",
      },
      {
        label: "Specific Territories",
        value: "territories",
        description: "Only notify for selected territories",
      },
      {
        label: "Specific Factions",
        value: "factions",
        description: "Only notify for selected factions",
      },
      {
        label: "Combined",
        value: "combined",
        description: "Notify for selected territories OR factions",
      },
    ];

    const options = notificationTypes.map((type) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(type.label)
        .setValue(type.value)
        .setDescription(type.description),
    );

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("territories_notification_type")
      .setPlaceholder("Select notification type...")
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu,
    );

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("🏠 Territories Module Setup")
      .setDescription(
        "Select how you want to receive territory change notifications:\n\n" +
          "**All Changes**: Notified whenever any territory changes ownership\n" +
          "**Specific Territories**: Only notified about territories you select\n" +
          "**Specific Factions**: Only notified about your faction(s)\n" +
          "**Combined**: Notified about selected territories OR factions",
      )
      .setFooter({
        text: "You can update this using /territories-config",
      });

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in territories-setup command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}

export async function handleNotificationTypeSelect(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const notificationType = interaction.values[0];

    // Update TT config
    const { error } = await supabase
      .from(TABLE_NAMES.TT_CONFIG)
      .update({
        notification_type: notificationType,
        updated_at: new Date().toISOString(),
      })
      .eq("guild_id", guildId);

    if (error) {
      throw error;
    }

    const typeLabels: Record<string, string> = {
      all: "All Changes",
      territories: "Specific Territories",
      factions: "Specific Factions",
      combined: "Combined (Territories OR Factions)",
    };

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Setup Complete")
      .setDescription(
        `Notification type set to: **${typeLabels[notificationType]}**\n\n` +
          "Use **/territories-config** to:\n" +
          "- View current settings\n" +
          "- Add specific territories or factions to monitor",
      );

    await interaction.editReply({
      embeds: [successEmbed],
      components: [],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in notification type handler:", errorMsg);
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
