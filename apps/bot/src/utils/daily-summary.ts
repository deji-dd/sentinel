/**
 * Daily stats summary calculation
 * Calculates stat gains over the previous 24 hours and generates summary data
 */

import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "@sentinel/shared";

const TCT_OFFSET_MS = 0; // TCT = UTC (no offset needed)

/** Target stat distribution ranges (percentage) */
export const STAT_DISTRIBUTION_TARGET = {
  strength: { min: 32, max: 36 },
  speed: { min: 21, max: 25 },
  defense: { min: 21, max: 23 },
  dexterity: { min: 21, max: 23 },
} as const;

interface DailyStatsSnapshot {
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
  total_stats: number;
}

export interface DailyStatsSummary {
  date: string; // Date in TCT (YYYY-MM-DD)
  gains: {
    strength: number;
    speed: number;
    defense: number;
    dexterity: number;
    total: number;
  };
  currentStats: {
    strength: number;
    speed: number;
    defense: number;
    dexterity: number;
    total: number;
  };
  distribution: {
    strength: {
      value: number;
      percentage: number;
      targetMin: number;
      targetMax: number;
      withinTarget: boolean;
      deviation: number; // percentage points from closest boundary
    };
    speed: {
      value: number;
      percentage: number;
      targetMin: number;
      targetMax: number;
      withinTarget: boolean;
      deviation: number;
    };
    defense: {
      value: number;
      percentage: number;
      targetMin: number;
      targetMax: number;
      withinTarget: boolean;
      deviation: number;
    };
    dexterity: {
      value: number;
      percentage: number;
      targetMin: number;
      targetMax: number;
      withinTarget: boolean;
      deviation: number;
    };
  };
  needsAttention: string[]; // List of stats that are significantly off target
}

/**
 * Get the last snapshot before a specific UTC timestamp
 */
async function getSnapshotBefore(
  beforeUtcTime: Date,
): Promise<DailyStatsSnapshot | null> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
    .select("strength, speed, defense, dexterity, total_stats")
    .lt("created_at", beforeUtcTime.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch battlestats snapshot: ${error.message}`);
  }

  return data as DailyStatsSnapshot | null;
}

/**
 * Calculate daily stats summary
 * @returns {DailyStatsSummary} Summary of stats gains and distribution
 */
export async function calculateDailyStatsSummary(): Promise<DailyStatsSummary> {
  // Get current time in TCT
  const nowUtc = new Date();
  const nowTct = new Date(nowUtc.getTime() - TCT_OFFSET_MS);

  // Get today at 00:00 TCT (in UTC terms: 05:00 UTC)
  const todayTct = new Date(nowTct);
  todayTct.setUTCHours(0, 0, 0, 0);
  const todayAtMidnightUtc = new Date(todayTct.getTime() + TCT_OFFSET_MS);

  // Get yesterday at 00:00 TCT
  const yesterdayTct = new Date(todayTct);
  yesterdayTct.setUTCDate(yesterdayTct.getUTCDate() - 1);
  const yesterdayAtMidnightUtc = new Date(
    yesterdayTct.getTime() + TCT_OFFSET_MS,
  );

  // Query snapshots
  const [snapshotA, snapshotB] = await Promise.all([
    getSnapshotBefore(todayAtMidnightUtc), // Last before today's midnight TCT
    getSnapshotBefore(yesterdayAtMidnightUtc), // Last before yesterday's midnight TCT
  ]);

  if (!snapshotA) {
    throw new Error("No battlestats snapshot found for today");
  }
  if (!snapshotB) {
    throw new Error("No battlestats snapshot found for yesterday");
  }

  // Calculate gains
  const gains = {
    strength: snapshotA.strength - snapshotB.strength,
    speed: snapshotA.speed - snapshotB.speed,
    defense: snapshotA.defense - snapshotB.defense,
    dexterity: snapshotA.dexterity - snapshotB.dexterity,
    total: snapshotA.total_stats - snapshotB.total_stats,
  };

  // Calculate distribution
  const total = snapshotA.total_stats;
  const needsAttention: string[] = [];

  const distribution = {
    strength: calculateStatDistribution(
      snapshotA.strength,
      total,
      "strength",
      needsAttention,
    ),
    speed: calculateStatDistribution(
      snapshotA.speed,
      total,
      "speed",
      needsAttention,
    ),
    defense: calculateStatDistribution(
      snapshotA.defense,
      total,
      "defense",
      needsAttention,
    ),
    dexterity: calculateStatDistribution(
      snapshotA.dexterity,
      total,
      "dexterity",
      needsAttention,
    ),
  };

  const tctDateStr = todayTct.toISOString().split("T")[0];

  return {
    date: tctDateStr,
    gains,
    currentStats: {
      strength: snapshotA.strength,
      speed: snapshotA.speed,
      defense: snapshotA.defense,
      dexterity: snapshotA.dexterity,
      total: snapshotA.total_stats,
    },
    distribution,
    needsAttention,
  };
}

/**
 * Calculate distribution for a single stat
 */
function calculateStatDistribution(
  value: number,
  total: number,
  statName: keyof typeof STAT_DISTRIBUTION_TARGET,
  needsAttention: string[],
): DailyStatsSummary["distribution"]["strength"] {
  const percentage = total > 0 ? (value / total) * 100 : 0;
  const target = STAT_DISTRIBUTION_TARGET[statName];
  const withinTarget = percentage >= target.min && percentage <= target.max;

  // Calculate deviation from target range
  let deviation = 0;
  if (percentage < target.min) {
    deviation = target.min - percentage;
  } else if (percentage > target.max) {
    deviation = percentage - target.max;
  }

  // Flag if stat is outside target range
  if (!withinTarget) {
    needsAttention.push(
      `${capitalize(statName)}: ${percentage.toFixed(1)}% (target: ${target.min}-${target.max}%)`,
    );
  }

  return {
    value,
    percentage,
    targetMin: target.min,
    targetMax: target.max,
    withinTarget,
    deviation,
  };
}

/**
 * Capitalize first letter of a string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
