/**
 * Burn Map Simulator Command
 * Generates a simulated burn map with random burned territories for testing/visualization
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";
import { generateBurnMapPng } from "../../../lib/burn-map-generator.js";

const STATUS_EMOJI_ERROR = "<:Red:1474607810368114886>";

export const data = new SlashCommandBuilder()
  .setName("burn-map-simulator")
  .setDescription(
    "Generate a simulated burn map with random burned territories",
  )
  .addIntegerOption((opt) =>
    opt
      .setName("burned_count")
      .setDescription(
        "Number of territories to simulate as burned (optional, random if not specified)",
      )
      .setMinValue(0)
      .setMaxValue(4108)
      .setRequired(false),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply();

    // Get all territories
    const { data: allTerritories, error: allTerritoriesError } = await supabase
      .from(TABLE_NAMES.TERRITORY_BLUEPRINT)
      .select("id");

    if (allTerritoriesError || !allTerritories) {
      throw new Error("Failed to fetch territory list");
    }

    const allTerritoryIds = allTerritories.map((t) => t.id);
    const totalTerritories = allTerritoryIds.length;

    // Determine burn count - use provided or random
    let burnedCount = interaction.options.getInteger("burned_count");
    if (burnedCount === null) {
      // Random between 0 and 10% of territories
      burnedCount = Math.floor(Math.random() * (totalTerritories * 0.1));
    }

    // Randomly select territories to burn
    const burnedTerritories: string[] = [];
    const shuffled = [...allTerritoryIds].sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(burnedCount, shuffled.length); i++) {
      burnedTerritories.push(shuffled[i]);
    }

    // Generate PNG
    const stats = {
      totalTerritories: totalTerritories,
      burnedCount: burnedTerritories.length,
      availableCount: totalTerritories - burnedTerritories.length,
    };

    console.log(
      `[burn-map-simulator] Generating simulated map (${burnedTerritories.length} burned territories)`,
    );

    let pngBuffer: Buffer;
    try {
      pngBuffer = await generateBurnMapPng(
        burnedTerritories,
        "SIMULATED Burn Map",
        stats,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[burn-map-simulator] PNG generation failed: ${errorMsg}`);
      throw error;
    }

    console.log(
      `[burn-map-simulator] Generated PNG (${pngBuffer.length} bytes)`,
    );

    // Create attachment
    const attachment = new AttachmentBuilder(pngBuffer, {
      name: "burn-map-simulator.png",
    });

    // Create embed with embedded image
    const embed = new EmbedBuilder()
      .setColor(burnedTerritories.length > 0 ? 0xef4444 : 0x22c55e)
      .setTitle("Territory Burn Map Simulator")
      .setImage("attachment://burn-map-simulator.png");

    // Add burned territories field - truncate if too long
    if (burnedTerritories.length === 0) {
      embed.addFields({
        name: "Result",
        value: "No burned territories",
        inline: false,
      });
    } else {
      const maxShowCount = 20;
      const territoriesList =
        burnedTerritories.length > maxShowCount
          ? `${burnedTerritories.slice(0, maxShowCount).join(", ")}...and ${burnedTerritories.length - maxShowCount} more`
          : burnedTerritories.join(", ");

      embed.addFields({
        name: `${STATUS_EMOJI_ERROR} Burned Territories (${burnedTerritories.length})`,
        value: `\`\`\`${territoriesList}\`\`\``,
        inline: false,
      });
    }

    embed
      .addFields({
        name: "Statistics",
        value: `Total: ${stats.totalTerritories}\nBurned: ${stats.burnedCount}\nAvailable: ${stats.availableCount}`,
        inline: true,
      })
      .setFooter({
        text: "Red = Simulated burn | Gray = Available | Random simulation for testing",
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
    });
  } catch (error) {
    let errorMsg = "An unknown error occurred";

    if (error instanceof Error) {
      errorMsg = error.message;
    } else if (typeof error === "object" && error !== null) {
      errorMsg =
        (error as Record<string, unknown>).message?.toString() ||
        JSON.stringify(error);
    } else if (typeof error === "string") {
      errorMsg = error;
    }

    console.error("Error in burn-map-simulator command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle(`${STATUS_EMOJI_ERROR} Error`)
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
