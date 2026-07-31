import {
  SlashCommandBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "@sentinel/database";
import { Logger } from "@sentinel/utils";
import { createBaseEmbed, createErrorEmbed, EMBED_COLORS } from "../lib/embeds.js";
import { generateBurnMapPng } from "../lib/burn-map-generator.js";
import {
  getBurnedTerritories,
  type WarRecord,
} from "../lib/territory-burn-logic.js";

const logger = new Logger("burn_map");

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

    // Get faction details
    const factionRecord = await db.faction.findUnique({
      where: { id: factionId },
    });

    const factionName = factionRecord?.name || `Faction ${factionId}`;
    const factionDisplay = `${factionName} (${factionId})`;

    // Fetch war ledger from last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const warsDocs = await db.warLedger.findMany({
      where: { startTime: { gte: ninetyDaysAgo } },
      orderBy: { startTime: "desc" },
    });

    const wars: WarRecord[] = warsDocs.map((w) => ({
      war_id: parseInt(w.id, 10) || 0,
      territory_id: w.tt,
      assaulting_faction: w.assaultingFaction,
      defending_faction: w.defendingFaction,
      victor_faction: w.victorFaction,
      start_time: w.startTime.toISOString(),
      end_time: w.endTime ? w.endTime.toISOString() : null,
    }));

    // Get current territory count for faction
    const currentTerritoryCount = await db.territoryState.count({
      where: { factionId },
    });

    // Get all territory blueprints
    const allTerritories = await db.territoryBlueprint.findMany();
    const allTerritoryIds = allTerritories.map((t) => t.id);

    // Fallback if blueprints table is empty
    const territoryIdsList =
      allTerritoryIds.length > 0
        ? allTerritoryIds
        : (await db.territoryState.findMany()).map((t) => t.id);

    // Get burned territories
    const burnedTerritories = getBurnedTerritories(
      factionId,
      territoryIdsList,
      wars,
      currentTerritoryCount,
    );

    const stats = {
      totalTerritories: territoryIdsList.length,
      burnedCount: burnedTerritories.length,
      availableCount: territoryIdsList.length - burnedTerritories.length,
    };

    logger.info(
      `Generating burn map for faction ${factionId} (${burnedTerritories.length} burned territories)`,
    );

    const pngBuffer = await generateBurnMapPng(
      burnedTerritories,
      factionDisplay,
      stats,
    );

    const attachment = new AttachmentBuilder(pngBuffer, {
      name: `burn-map-${factionId}.png`,
    });

    const embedColor =
      burnedTerritories.length > 0 ? EMBED_COLORS.DANGER : EMBED_COLORS.SUCCESS;

    const embed = createBaseEmbed("Territory Burn Map", undefined, embedColor)
      .setImage(`attachment://burn-map-${factionId}.png`)
      .addFields(
        { name: "Faction", value: factionDisplay, inline: true },
        {
          name: "Status",
          value:
            burnedTerritories.length === 0
              ? "No burned territories"
              : `${burnedTerritories.length} burned`,
          inline: true,
        },
      );

    if (!wars || wars.length === 0) {
      embed.addFields({
        name: "Data Warning",
        value:
          "No war history found in the last 90 days. All territories shown as available.",
        inline: false,
      });
    }

    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Error in burn-map command:", errorMsg);

    const errorEmbed = createErrorEmbed("Error", errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
