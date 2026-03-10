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

const COLOR_UNALIGNED = "#94a3b8";

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function colorForAllianceName(name: string): string {
  if (name === "Unaligned") {
    return COLOR_UNALIGNED;
  }

  const hash = hashString(name);
  const hue = hash % 360;
  const saturation = 58 + (hash % 18); // 58-75
  const lightness = 44 + (hash % 12); // 44-55
  return hslToHex(hue, saturation, lightness);
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
      (entry) => `${entry.color} ${entry.alliance} (${entry.territories})`,
    );
    const legendChunks = buildLegendChunks(legendLines);

    const totalControlled = ownershipRows.filter(
      (row) => row.faction_id !== null,
    ).length;
    const neutralCount = ownershipRows.length - totalControlled;

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Territory Alliance Control Map")
      .setImage("attachment://alliance-map.png")
      .setDescription(
        "Map colors represent alliance ownership. Legend is listed below.",
      )
      .addFields(
        {
          name: "Territories",
          value: `${ownershipRows.length}`,
          inline: true,
        },
        {
          name: "Controlled",
          value: `${totalControlled}`,
          inline: true,
        },
        {
          name: "Neutral",
          value: `${neutralCount}`,
          inline: true,
        },
        {
          name: "Alliances Visible",
          value: `${rankedAlliances.length}`,
          inline: true,
        },
        {
          name: "Unaligned Color",
          value: `${COLOR_UNALIGNED}`,
          inline: true,
        },
      )
      .setFooter({
        text: "Alliance data: remote GitHub with local snapshot fallback",
      })
      .setTimestamp();

    if (legendChunks.length === 0) {
      embed.addFields({
        name: "Legend",
        value: "No currently controlled territories found.",
        inline: false,
      });
    } else {
      for (let i = 0; i < legendChunks.length; i++) {
        embed.addFields({
          name: legendChunks.length === 1 ? "Legend" : `Legend ${i + 1}`,
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
