/**
 * Territory Assault Check Command
 * Check if faction can assault a territory based on cooldown constraints
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  GuildApiKeys,
  decryptApiKey,
  validateAndFetchFactionDetails,
  WarLedger,
  TerritoryStates,
} from "@sentinel/shared";
import { type WarRecord } from "../../../lib/territory-burn-logic.js";

const STATUS_EMOJI_SUCCESS = "<:Green:1474607376140079104>";
const STATUS_EMOJI_ERROR = "<:Red:1474607810368114886>";

async function getActiveApiKey(guildId: string): Promise<string | null> {
  const allKeys = GuildApiKeys.find({ guild_id: guildId });
  const keyDoc = allKeys.find((k) => k.is_primary) || allKeys[0];
  if (!keyDoc) return null;

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("CRITICAL: ENCRYPTION_KEY is not set in environment");
  }

  return decryptApiKey(keyDoc.api_key_encrypted, encryptionKey);
}

export const data = new SlashCommandBuilder()
  .setName("assault-check")
  .setDescription("Check if your faction can assault a territory")
  .addIntegerOption((opt) =>
    opt
      .setName("faction_id")
      .setDescription("Faction ID to check")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("territory_id")
      .setDescription("Territory ID or code (e.g., LSG)")
      .setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.deferReply();

    const factionId = interaction.options.getInteger("faction_id", true);
    const territoryId = interaction.options.getString("territory_id", true);
    const guildId = interaction.guildId;
    const apiKey = guildId ? await getActiveApiKey(guildId) : null;
    const factionName = await validateAndFetchFactionDetails(factionId, apiKey);
    const factionDisplay = factionName
      ? `${factionName} (${factionId})`
      : `Faction ${factionId} (${factionId})`;
    const needsApiKeyWarning = !apiKey && !factionName;

    // Fetch war ledger from last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysMs = ninetyDaysAgo.getTime();

    const warsDocs = WarLedger.findAll((w) => w.start_time >= ninetyDaysMs);
    warsDocs.sort((a, b) => b.start_time - a.start_time);
    const wars: WarRecord[] = warsDocs.map((w) => ({
      war_id: parseInt(w.id, 10),
      territory_id: w.id,
      assaulting_faction: w.assaulting_faction,
      defending_faction: w.defending_faction,
      victor_faction: w.victor_faction,
      start_time: new Date(w.start_time).toISOString(),
      end_time: w.end_time ? new Date(w.end_time).toISOString() : null,
    }));

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("⚔️ Territory Assault Check")
      .addFields({
        name: "Faction",
        value: factionDisplay,
        inline: true,
      })
      .addFields({
        name: "Territory",
        value: territoryId.toUpperCase(),
        inline: true,
      });

    if (needsApiKeyWarning) {
      embed.addFields({
        name: "API Key",
        value:
          "No API key configured for live faction lookup. Displayed name may be unavailable.",
        inline: false,
      });
    }

    let canAssault = true;
    const issues: string[] = [];
    const infoNotes: string[] = [];

    // Get current territory count for faction
    const ownedTerritories = TerritoryStates.find({ faction_id: factionId });

    const currentTerritoryCount = ownedTerritories?.length || 0;

    // Check Rule 1: If faction lost their last territory, 72h cooldown before claiming in Sector 7
    const factionWarsDef = wars?.filter(
      (w) =>
        (w.defending_faction === factionId ||
          w.assaulting_faction === factionId) &&
        w.victor_faction !== factionId,
    );

    if (
      factionWarsDef &&
      factionWarsDef.length > 0 &&
      currentTerritoryCount === 0
    ) {
      const lastLoss = factionWarsDef[0]; // Most recent loss first
      const lossTrigger = 72 * 60 * 60 * 1000; // 72 hours
      const timeSinceLoss =
        Date.now() - new Date(lastLoss.start_time).getTime();

      if (timeSinceLoss < lossTrigger) {
        const hoursRemaining = Math.ceil(
          (lossTrigger - timeSinceLoss) / (60 * 60 * 1000),
        );
        infoNotes.push(
          `ℹ️ Faction has 0 territories and lost a war ${hoursRemaining}h ago. 72h cooldown applies before claiming in Sector 7.`,
        );
      }
    } else if (currentTerritoryCount > 0) {
      infoNotes.push(
        `ℹ️ Faction currently owns ${currentTerritoryCount} territor${currentTerritoryCount === 1 ? "y" : "ies"}.`,
      );
    } else if (currentTerritoryCount === 0) {
      infoNotes.push(`ℹ️ Faction currently owns 0 territories.`);
    }

    // Check specific territory cooldowns
    const territoryWars = wars?.filter(
      (w) => w.territory_id === territoryId.toUpperCase(),
    );

    if (territoryWars && territoryWars.length > 0) {
      // Check if faction lost on this territory in last 72 hours
      const factionsWarOnThis = territoryWars.filter(
        (w) =>
          (w.assaulting_faction === factionId ||
            w.defending_faction === factionId) &&
          w.victor_faction !== factionId,
      );

      if (factionsWarOnThis.length > 0) {
        const lastLossOnThis = factionsWarOnThis[0];
        const timeSinceLoss =
          Date.now() - new Date(lastLossOnThis.start_time).getTime();
        const lossTrigger = 72 * 60 * 60 * 1000;

        if (timeSinceLoss < lossTrigger) {
          const hoursRemaining = Math.ceil(
            (lossTrigger - timeSinceLoss) / (60 * 60 * 1000),
          );
          issues.push(
            `⏱️ Lost war on this territory: ${hoursRemaining}h remaining`,
          );
          canAssault = false;
        }
      }

      // Check 90-day rule: if faction has warred this territory in last 90 days,
      // must wait 72h after ANY war on this territory (even by other factions)
      const factionWarsOnThisTerritory = territoryWars.filter(
        (w) =>
          w.assaulting_faction === factionId ||
          w.defending_faction === factionId,
      );

      if (factionWarsOnThisTerritory.length > 0) {
        // Faction has warred this territory in last 90 days
        // Check if ANY faction has warred this territory in last 72 hours
        const lastWarOnThis = territoryWars[0]; // Most recent war by ANY faction
        const timeSinceAnyWar =
          Date.now() - new Date(lastWarOnThis.start_time).getTime();
        const waitTrigger = 72 * 60 * 60 * 1000;

        if (timeSinceAnyWar < waitTrigger) {
          const hoursRemaining = Math.ceil(
            (waitTrigger - timeSinceAnyWar) / (60 * 60 * 1000),
          );
          issues.push(
            `⏱️ 90-day rule: Recent war on territory by any faction (${hoursRemaining}h remaining)`,
          );
          canAssault = false;
        }
      }
    }

    // Determine overall status
    if (canAssault && issues.length === 0) {
      embed.setColor(0x22c55e);
      embed.addFields({
        name: "Status",
        value: `${STATUS_EMOJI_SUCCESS} **Can Assault**`,
        inline: false,
      });
      embed.addFields({
        name: "Details",
        value:
          "No active cooldowns - faction is eligible to assault this territory",
        inline: false,
      });
    } else if (!canAssault) {
      embed.setColor(0xef4444);
      embed.addFields({
        name: "Status",
        value: `${STATUS_EMOJI_ERROR} **Cannot Assault**`,
        inline: false,
      });
      embed.addFields({
        name: "Active Cooldowns",
        value: issues.join("\n"),
        inline: false,
      });
    } else {
      // Warnings but can still assault
      embed.setColor(0xf59e0b);
      embed.addFields({
        name: "Status",
        value: "⚠️ **Can Assault (With Warnings)**",
        inline: false,
      });
      embed.addFields({
        name: "Active Cooldowns",
        value: issues.join("\n"),
        inline: false,
      });
    }

    // Add informational notes (not blocking)
    if (infoNotes.length > 0) {
      embed.addFields({
        name: "ℹ️ Additional Information",
        value: infoNotes.join("\n"),
        inline: false,
      });
    }

    // Data freshness warning
    let showDataWarning = false;
    let dataWarningText =
      "No war history found in the last 90 days. Results may be inaccurate.";

    if (!wars || wars.length === 0) {
      showDataWarning = true;
    } else {
      const oldestWar = wars[wars.length - 1];
      const oldestStart = new Date(oldestWar.start_time);
      if (oldestStart > ninetyDaysAgo) {
        const daysCoverage = Math.max(
          1,
          Math.floor((Date.now() - oldestStart.getTime()) / 86400000),
        );
        showDataWarning = true;
        dataWarningText = `Only ~${daysCoverage} day${daysCoverage === 1 ? "" : "s"} of war data available. Results may be inaccurate.`;
      }
    }

    if (showDataWarning) {
      embed.addFields({
        name: "⚠️ Data Warning",
        value: dataWarningText,
        inline: false,
      });
      embed.setFooter({
        text: "Results may be incomplete without 90 days of war data.",
      });
    }

    await interaction.editReply({
      embeds: [embed],
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

    console.error("Error in assault-check command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle(`${STATUS_EMOJI_ERROR} Error`)
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
