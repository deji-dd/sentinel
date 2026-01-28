import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthorizedUser } from "../lib/auth.js";

export const data = {
  name: "settings",
  description: "Configure your Sentinel preferences",
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
) {
  const discordId = interaction.user.id;
  const userId = await getAuthorizedUser(supabase, discordId);

  if (!userId) {
    const notLinkedEmbed = new EmbedBuilder()
      .setColor(0xdc2626)
      .setTitle("❌ Account Not Linked")
      .setDescription(
        "Your Discord account is not linked to Sentinel. Please use `/setup` first to link your Torn account.",
      )
      .addFields({
        name: "🔗 How to Link",
        value:
          "Run the `/setup` command and follow the instructions to securely link your Torn City account.",
        inline: false,
      })
      .setFooter({ text: "Sentinel Settings" })
      .setTimestamp();

    await interaction.reply({
      embeds: [notLinkedEmbed],
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  // Create module selection menu
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("settings_module_select")
    .setPlaceholder("Choose a module to configure")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Travel Settings")
        .setDescription("Configure travel alerts and preferences")
        .setValue("travel")
        .setEmoji("🌍"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Account Settings")
        .setDescription("Update your Torn API key")
        .setValue("account")
        .setEmoji("🔑"),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    selectMenu,
  );

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("⚙️ Sentinel Settings")
    .setDescription(
      "Select a module below to configure your preferences.\n\n" +
        "**Available Modules:**\n" +
        "🌍 **Travel Settings** - Manage alerts, blacklists, and profit filters\n" +
        "🔑 **Account Settings** - Update your Torn API key",
    )
    .setFooter({ text: "Sentinel Settings" })
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
  });
}
