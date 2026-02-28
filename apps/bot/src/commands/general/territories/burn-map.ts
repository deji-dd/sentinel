/**
 * Burn Map Command
 * Generates a visual map showing territories that a faction cannot assault
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  TABLE_NAMES,
  getBurnedTerritories,
  getFactionNameCached,
} from "@sentinel/shared";
import { generateBurnMapPng } from "../../../lib/burn-map-generator.js";
import { getGuildApiKeys } from "../../../lib/guild-api-keys.js";
import { tornApi } from "../../../services/torn-client.js";
import { supabase } from "../../../lib/supabase.js";

const STATUS_EMOJI_SUCCESS = "<:Green:1474607376140079104>";
const STATUS_EMOJI_ERROR = "<:Red:1474607810368114886>";

async function getActiveApiKey(guildId: string): Promise<string | null> {
  const apiKeys = await getGuildApiKeys(guildId);
  return apiKeys.length > 0 ? apiKeys[0] : null;
}

export const data = new SlashCommandBuilder()
  .setName("burn-map")
  .setDescription("Generate a visual burn map for a faction")
  .addIntegerOption((opt) =>
    opt
      .setName("faction_id")
      .setDescription("Faction ID to generate burn map for")
      .setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.deferReply();

    const factionId = interaction.options.getInteger("faction_id", true);
    const guildId = interaction.guildId;
    const apiKey = guildId ? await getActiveApiKey(guildId) : null;

    // Get faction name
    const factionName = await getFactionNameCached(
      supabase,
      factionId,
      tornApi,
      apiKey,
    );
    const factionDisplay = factionName
      ? `${factionName} (${factionId})`
      : `Faction ${factionId}`;

    // Fetch war ledger from last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: wars, error: warsError } = await supabase
      .from(TABLE_NAMES.WAR_LEDGER)
      .select("*")
      .gte("start_time", ninetyDaysAgo.toISOString())
      .order("start_time", { ascending: false });

    if (warsError) {
      throw warsError;
    }

    // Get current territory count for faction
    const { data: ownedTerritories, error: territoriesError } = await supabase
      .from(TABLE_NAMES.TERRITORY_STATE)
      .select("territory_id")
      .eq("faction_id", factionId);

    if (territoriesError) {
      console.warn("Failed to fetch faction territories:", territoriesError);
    }

    const currentTerritoryCount = ownedTerritories?.length || 0;

    // Get all territories
    const { data: allTerritories, error: allTerritoriesError } = await supabase
      .from(TABLE_NAMES.TERRITORY_BLUEPRINT)
      .select("id");

    if (allTerritoriesError || !allTerritories) {
      throw new Error("Failed to fetch territory list");
    }

    const allTerritoryIds = allTerritories.map((t) => t.id);

    // Get burned territories
    const burnedTerritories = getBurnedTerritories(
      factionId,
      allTerritoryIds,
      wars || [],
      currentTerritoryCount,
    );

    // Generate SVG
    const stats = {
      totalTerritories: allTerritoryIds.length,
      burnedCount: burnedTerritories.length,
      availableCount: allTerritoryIds.length - burnedTerritories.length,
    };

    console.log(
      `[burn-map] Generating map for faction ${factionId}`,
      `(${burnedTerritories.length} burned territories)`,
    );

    let pngBuffer: Buffer;
    try {
      pngBuffer = await generateBurnMapPng(
        burnedTerritories,
        factionDisplay,
        stats,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[burn-map] PNG generation failed: ${errorMsg}`);
      throw error;
    }

    console.log(`[burn-map] Generated PNG (${pngBuffer.length} bytes)`);

    // Create attachment
    const attachment = new AttachmentBuilder(pngBuffer, {
      name: `burn-map-${factionId}.png`,
    });

    // Create embed with embedded image
    const embed = new EmbedBuilder()
      .setColor(burnedTerritories.length > 0 ? 0xef4444 : 0x22c55e)
      .setTitle("Territory Burn Map")
      .setImage(`attachment://burn-map-${factionId}.png`)
      .addFields({
        name: "Faction",
        value: factionDisplay,
        inline: true,
      })
      .addFields({
        name: "Status",
        value:
          burnedTerritories.length === 0
            ? `${STATUS_EMOJI_SUCCESS} No burned territories`
            : `${STATUS_EMOJI_ERROR} ${burnedTerritories.length} burned`,
        inline: true,
      })
      .setFooter({
        text: "Red = Cannot assault (72h cooldown) | Gray = Available to assault",
      })
      .setTimestamp();

    // Data freshness warning
    if (!wars || wars.length === 0) {
      embed.addFields({
        name: "⚠️ Data Warning",
        value:
          "No war history found in the last 90 days. All territories shown as available.",
        inline: false,
      });
    } else {
      const oldestWar = wars[wars.length - 1];
      const oldestStart = new Date(oldestWar.start_time);
      if (oldestStart > ninetyDaysAgo) {
        const daysCoverage = Math.max(
          1,
          Math.floor((Date.now() - oldestStart.getTime()) / 86400000),
        );
        embed.addFields({
          name: "⚠️ Data Warning",
          value: `Only ~${daysCoverage} day${daysCoverage === 1 ? "" : "s"} of war data available. Results may be incomplete.`,
          inline: false,
        });
      }
    }

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

    console.error("Error in burn-map command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle(`${STATUS_EMOJI_ERROR} Error`)
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
