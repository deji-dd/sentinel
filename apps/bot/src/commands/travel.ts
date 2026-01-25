/* eslint-disable @typescript-eslint/no-explicit-any */
import { EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function executeTravel(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    // Defer the reply immediately (Discord requires response within 3 seconds)
    await interaction.deferReply({ ephemeral: true });

    // Use interaction.user.id (Discord user ID) to identify the user
    const userId = interaction.user.id;

    // Fetch travel recommendations for this Discord user with their Torn name
    const { data: userData, error: userError } = await supabase
      .from("sentinel_user_data")
      .select("user_id, name")
      .eq("discord_id", userId)
      .single();

    if (userError || !userData) {
      const notLinkedEmbed = new EmbedBuilder()
        .setColor(0xdc2626)
        .setTitle("Account Not Linked")
        .setDescription(
          "Your Discord account is not linked to Torn. Please authenticate first to see your travel recommendations.",
        )
        .addFields({
          name: "What to do?",
          value:
            "Use the authentication command to link your Torn account with your Discord profile.",
          inline: false,
        })
        .setFooter({ text: "Sentinel Travel Recommendations" })
        .setTimestamp();

      await interaction.editReply({
        embeds: [notLinkedEmbed],
      });
      return;
    }

    // Now we have the sentinel user_id, fetch the top recommendation with destination details
    const tornUserId = userData.user_id;
    const tornName = userData.name;

    const { data: travelRecs, error: recsError } = await supabase
      .from("sentinel_travel_recommendations")
      .select(
        `
        *,
        sentinel_torn_destinations(name),
        sentinel_torn_items!best_item_id(name)
      `,
      )
      .eq("user_id", tornUserId)
      .order("recommendation_rank", { ascending: true })
      .limit(1);

    if (recsError || !travelRecs || travelRecs.length === 0) {
      const noRecsEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("No Recommendations Available")
        .setDescription(
          "We don't have travel recommendations for you yet. Check back later or sync your data.",
        )
        .addFields({
          name: "Need to sync?",
          value:
            "Travel recommendations are updated regularly based on your profile data.",
          inline: false,
        })
        .setFooter({ text: "Sentinel Travel Recommendations" })
        .setTimestamp();

      await interaction.editReply({
        embeds: [noRecsEmbed],
      });
      return;
    }

    // Get the top recommendation (rank 1)
    const topRec = travelRecs[0] as any;
    const destinationName =
      topRec.sentinel_torn_destinations?.name || "Unknown";
    const itemName = topRec.sentinel_torn_items?.name || "Unknown";
    const profitPerMinute = topRec.profit_per_minute
      ? `$${Number(topRec.profit_per_minute).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "N/A";
    const cashToCarry = topRec.profit_per_trip
      ? `$${Number(topRec.profit_per_trip).toLocaleString("en-US")}`
      : "N/A";
    const roundTripTime = topRec.round_trip_minutes
      ? `${topRec.round_trip_minutes} minutes`
      : "N/A";

    // Check if data is older than 30 minutes
    const lastUpdatedDate = topRec.updated_at
      ? new Date(topRec.updated_at)
      : null;
    const now = new Date();
    const isOutdated = lastUpdatedDate
      ? now.getTime() - lastUpdatedDate.getTime() > 30 * 60 * 1000
      : false;

    const lastUpdated = lastUpdatedDate
      ? lastUpdatedDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Unknown";

    const warningText = topRec.message ? `⚠️ Warning: ${topRec.message}` : null;

    // Build beautiful embed for the recommendation
    const recommendationEmbed = new EmbedBuilder()
      .setColor(isOutdated ? 0xf59e0b : 0x10b981)
      .setTitle("🌍 Top Travel Recommendation")
      .setDescription(
        `**${tornName}**, based on your profile, here's your best travel destination.`,
      )
      .addFields(
        {
          name: "Destination",
          value: `**${destinationName}**`,
          inline: true,
        },
        {
          name: "Profit Per Minute",
          value: profitPerMinute,
          inline: true,
        },
        {
          name: "Best Item to Buy",
          value: itemName,
          inline: true,
        },
        {
          name: "Cash to Carry",
          value: cashToCarry,
          inline: true,
        },
        {
          name: "Round Trip Time",
          value: roundTripTime,
          inline: true,
        },
        {
          name: "Data Last Updated",
          value: lastUpdated,
          inline: true,
        },
      );

    if (isOutdated) {
      recommendationEmbed.addFields({
        name: "⚠️ Information Outdated",
        value:
          "This data is older than 30 minutes. Consider syncing for fresh recommendations.",
        inline: false,
      });
    }

    if (warningText) {
      recommendationEmbed.addFields({
        name: "Note",
        value: warningText,
        inline: false,
      });
    }

    recommendationEmbed
      .setFooter({
        text: "Sentinel Travel Recommendations",
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [recommendationEmbed],
    });
  } catch (error) {
    console.error("Travel command error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Error")
      .setDescription("An error occurred while fetching your recommendation.")
      .setFooter({ text: "Sentinel Travel Recommendations" })
      .setTimestamp();

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
