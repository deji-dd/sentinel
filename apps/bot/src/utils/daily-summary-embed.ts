/**
 * Daily stats summary embed builder
 * Constructs a beautiful Discord embed for the daily stats summary
 */

import { EmbedBuilder } from "discord.js";
import {
  calculateDailyStatsSummary,
  type DailyStatsSummary,
} from "./daily-summary.js";

const COLORS = {
  positive: 0x43b581, // Green
  neutral: 0x7289da, // Discord blurple
  negative: 0xf04747, // Red
  warning: 0xfaa61a, // Orange
} as const;

/**
 * Build a Discord embed for the daily stats summary
 */
export async function buildDailySummaryEmbed(): Promise<EmbedBuilder> {
  const summary = await calculateDailyStatsSummary();

  const embed = new EmbedBuilder()
    .setColor(
      summary.needsAttention.length > 0 ? COLORS.warning : COLORS.positive,
    )
    .setTitle(`📊 Daily Stats Summary - ${formatTctDate(summary.date)}`)
    .setTimestamp();

  // Raw Gains Field
  const gainsValue = [
    `Strength: **+${summary.gains.strength}**`,
    `Speed: **+${summary.gains.speed}**`,
    `Defense: **+${summary.gains.defense}**`,
    `Dexterity: **+${summary.gains.dexterity}**`,
    `\nTotal Gains: **+${summary.gains.total}**`,
  ].join("\n");

  embed.addFields({
    name: "📍 Raw Gains (24h)",
    value: gainsValue,
    inline: false,
  });

  // Current Totals Field
  const totalsValue = [
    `Strength: **${summary.currentStats.strength.toLocaleString()}**`,
    `Speed: **${summary.currentStats.speed.toLocaleString()}**`,
    `Defense: **${summary.currentStats.defense.toLocaleString()}**`,
    `Dexterity: **${summary.currentStats.dexterity.toLocaleString()}**`,
    `\nTotal Stats: **${summary.currentStats.total.toLocaleString()}**`,
  ].join("\n");

  embed.addFields({
    name: "📊 Current Totals",
    value: totalsValue,
    inline: false,
  });

  // Distribution Field (vs Target)
  const distributionValue = buildDistributionString(summary);
  embed.addFields({
    name: "Distribution vs Target",
    value: distributionValue,
    inline: false,
  });

  // Attention Needed Field (if applicable)
  if (summary.needsAttention.length > 0) {
    embed.addFields({
      name: "Needs Attention",
      value: summary.needsAttention.map((stat) => `• ${stat}`).join("\n"),
      inline: false,
    });
  }

  return embed;
}

/**
 * Build the distribution comparison string with visual indicators
 */
function buildDistributionString(summary: DailyStatsSummary): string {
  const lines: string[] = [];

  for (const [statName, stat] of Object.entries(summary.distribution) as Array<
    [string, (typeof summary.distribution)[keyof typeof summary.distribution]]
  >) {
    const bar = buildProgressBar(
      stat.percentage,
      stat.targetMin,
      stat.targetMax,
    );
    const statusIndicator = getStatusIndicator(
      stat.withinTarget,
      stat.deviation,
    );

    lines.push(
      `**${capitalize(statName)}**: ${stat.percentage.toFixed(1)}% → ${bar} ${statusIndicator}`,
    );
  }

  lines.push(
    `\nTarget Ranges: STR 32-36% | SPD 21-25% | DEF 21-23% | DEX 21-23%`,
  );

  return lines.join("\n");
}

/**
 * Build a simple progress bar visual showing both current value and target range
 */
function buildProgressBar(
  current: number,
  targetMin: number,
  targetMax: number,
  width: number = 10,
): string {
  const filled = Math.round((current / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);

  return `[${bar}] (${targetMin}-${targetMax}%)`;
}

/**
 * Get a status indicator for a stat's distribution
 */
function getStatusIndicator(withinTarget: boolean, deviation: number): string {
  if (withinTarget) {
    return "✓";
  } else if (deviation <= 2) {
    return "~";
  } else {
    return "✗";
  }
}

/**
 * Format the TCT date string for display
 */
function formatTctDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Capitalize first letter of a string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
