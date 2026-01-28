import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";

export const data = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Search for Torn items or categories by name")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("item")
      .setDescription("Search for items by name")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription("Item name to search for")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("category").setDescription("List all item categories"),
  )
  .setIntegrationTypes([0, 1])
  .setContexts([0, 1, 2]);

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "item") {
    const query = interaction.options.getString("query", true);

    // Search items by name (case-insensitive, partial match)
    const { data: items, error } = await supabase
      .from(TABLE_NAMES.TORN_ITEMS)
      .select("id, name, type")
      .ilike("name", `%${query}%`)
      .order("name")
      .limit(25); // Discord embed field limit

    if (error) {
      await interaction.reply({
        content: "❌ Failed to search items. Please try again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!items || items.length === 0) {
      await interaction.reply({
        content: `No items found matching "${query}".`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🔍 Items matching "${query}"`)
      .setDescription(
        `Found ${items.length} item${items.length === 1 ? "" : "s"}. Use the ID in your blacklist settings.`,
      )
      .setColor(0x00ff00);

    // Add items as fields
    for (const item of items) {
      embed.addFields({
        name: item.name,
        value: `ID: \`${item.id}\` | Category: ${item.type}`,
        inline: false,
      });
    }

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  } else if (subcommand === "category") {
    // List all categories
    const { data: categories, error } = await supabase
      .from(TABLE_NAMES.TORN_CATEGORIES)
      .select("id, name")
      .order("name");

    if (error) {
      await interaction.reply({
        content: "❌ Failed to fetch categories. Please try again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!categories || categories.length === 0) {
      await interaction.reply({
        content: "No categories found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("📋 All Item Categories")
      .setDescription(
        "Use category names (not IDs) in your travel settings blacklist.",
      )
      .setColor(0x0099ff);

    // Group categories into chunks for better display
    const categoryList = categories.map((cat) => `• ${cat.name}`).join("\n");

    embed.addFields({
      name: "Available Categories",
      value: categoryList,
      inline: false,
    });

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }
}
