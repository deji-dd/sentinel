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
import { generateBurnMapPng } from "../../../lib/burn-map-generator.js";
import {
  GuildApiKeys,
  decryptApiKey,
  validateAndFetchFactionDetails,
  WarLedger,
  TerritoryStates,
  TerritoryBlueprints,
} from "@sentinel/shared";

import {
  getBurnedTerritories,
  type WarRecord,
} from "../../../lib/territory-burn-logic.js";

const STATUS_EMOJI_SUCCESS = "<:Green:1474607376140079104>";
const STATUS_EMOJI_ERROR = "<:Red:1474607810368114886>";

async function getActiveApiKey(guildId: string): Promise<string | null> {
  const allKeys = GuildApiKeys.find((k) => k.guild_id === guildId);
  const keyDoc = allKeys.find((k) => k.is_primary) || allKeys[0];
  if (!keyDoc) return null;

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("CRITICAL: ENCRYPTION_KEY is not set in environment");
  }

  return decryptApiKey(keyDoc.api_key_encrypted, encryptionKey);
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
    const factionName = await validateAndFetchFactionDetails(factionId, apiKey);
    const factionDisplay = factionName
      ? `${factionName} (${factionId})`
      : `Faction ${factionId}`;

    // Fetch war ledger from last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const ninetyDaysMs = ninetyDaysAgo.getTime();

    const warsDocs = WarLedger.find((w) => w.start_time >= ninetyDaysMs);
    warsDocs.sort((a, b) => b.start_time - a.start_time);
    const wars: WarRecord[] = warsDocs.map((w) => ({
      war_id: parseInt(w.id, 10),
      territory_id: w.territory_id,
      assaulting_faction: w.assaulting_faction,
      defending_faction: w.defending_faction,
      victor_faction: w.victor_faction,
      start_time: new Date(w.start_time).toISOString(),
      end_time: w.end_time ? new Date(w.end_time).toISOString() : null,
    }));

    // Get current territory count for faction
    const ownedTerritories = TerritoryStates.find(
      (t) => t.faction_id === factionId,
    );

    const currentTerritoryCount = ownedTerritories?.length || 0;

    // Get all territories
    const allTerritories = TerritoryBlueprints.findAll();
    const allTerritoryIds = allTerritories.map((t) => t.id);

    // Get burned territories
    const burnedTerritories = getBurnedTerritories(
      factionId,
      allTerritoryIds,
      wars,
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
