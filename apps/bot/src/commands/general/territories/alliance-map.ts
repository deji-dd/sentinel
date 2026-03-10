import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../../lib/db-client.js";
import { getFactionToAllianceMap } from "../../../lib/faction-alliances.js";
import { generateAllianceMapPng } from "../../../lib/alliance-map-generator.js";

type TerritoryOwnershipRow = {
  territory_id: string;
  faction_id: number | null;
};

const DISTINCT_COLORS = [
  "#e74c3c", // red
  "#27ae60", // green
  "#3498db", // blue
  "#f39c12", // orange
  "#9b59b6", // purple
  "#e91e63", // pink
  "#795548", // brown
  "#1abc9c", // teal
  "#f1c40f", // yellow
  "#34495e", // slate
];

const COLOR_UNALIGNED = "#95a5a6"; // neutral gray

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function colorForAllianceName(name: string): string {
  if (name === "Unaligned") {
    return COLOR_UNALIGNED;
  }

  const hash = hashString(name);
  return DISTINCT_COLORS[hash % DISTINCT_COLORS.length];
}

function buildLegendChunks(lines: string[]): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > 1000) {
      if (current) {
        chunks.push(current);
      }
      current = line;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.slice(0, 3);
}

export const data = new SlashCommandBuilder()
  .setName("alliance-map")
  .setDescription("Generate territory map color-coded by alliance control");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.deferReply();

    const [ownershipRows, factionToAlliance] = await Promise.all([
      db
        .selectFrom(TABLE_NAMES.TERRITORY_STATE)
        .select(["territory_id", "faction_id"])
        .execute() as Promise<TerritoryOwnershipRow[]>,
      getFactionToAllianceMap(),
    ]);

    const allianceCounts = new Map<string, number>();
    const territoryFillById = new Map<string, string>();

    for (const row of ownershipRows) {
      if (!row.faction_id) {
        continue;
      }

      const allianceName = factionToAlliance.get(row.faction_id) ?? "Unaligned";
      const color = colorForAllianceName(allianceName);

      territoryFillById.set(row.territory_id, color);
      allianceCounts.set(
        allianceName,
        (allianceCounts.get(allianceName) || 0) + 1,
      );
    }

    const pngBuffer = await generateAllianceMapPng(territoryFillById);

    const attachment = new AttachmentBuilder(pngBuffer, {
      name: "alliance-map.png",
    });

    const rankedAlliances = [...allianceCounts.entries()]
      .map(([alliance, territories]) => ({
        alliance,
        territories,
        color: colorForAllianceName(alliance),
      }))
      .sort(
        (a, b) =>
          b.territories - a.territories || a.alliance.localeCompare(b.alliance),
      );

    const legendLines = rankedAlliances.map(
      (entry) => `${entry.alliance}: ${entry.territories} territories`,
    );
    const legendChunks = buildLegendChunks(legendLines);

    const totalControlled = ownershipRows.filter(
      (row) => row.faction_id !== null,
    ).length;
    const neutralCount = ownershipRows.length - totalControlled;
    const unalignedControlledCount = allianceCounts.get("Unaligned") || 0;

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Territory Alliance Control Map")
      .setImage("attachment://alliance-map.png")
      .setDescription(
        "Territories are color-coded by alliance. Each alliance uses a distinct color for easy identification.",
      )
      .addFields(
        {
          name: "Territories",
          value: `${ownershipRows.length}`,
          inline: true,
        },
        {
          name: "Occupied",
          value: `${totalControlled}`,
          inline: true,
        },
        {
          name: "No Owner",
          value: `${neutralCount}`,
          inline: true,
        },
        {
          name: "Alliances Visible",
          value: `${rankedAlliances.length}`,
          inline: true,
        },
        {
          name: "Not In Alliance List",
          value: `${unalignedControlledCount}`,
          inline: true,
        },
      )
      .setFooter({
        text: "Neutral = no owning faction | Unaligned = faction not mapped to an alliance",
      })
      .setTimestamp();

    if (legendChunks.length === 0) {
      embed.addFields({
        name: "Alliance Territory Count",
        value: "No currently controlled territories found.",
        inline: false,
      });
    } else {
      for (let i = 0; i < legendChunks.length; i++) {
        embed.addFields({
          name:
            legendChunks.length === 1
              ? "Alliance Territory Count"
              : `Territory Count ${i + 1}`,
          value: `\`\`\`${legendChunks[i]}\`\`\``,
          inline: false,
        });
      }
    }

    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in alliance-map command:", errorMsg);

    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
