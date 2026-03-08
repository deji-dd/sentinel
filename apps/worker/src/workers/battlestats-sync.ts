/**
 * Battlestats sync worker
 * Runs every minute to fetch battlestats from Torn API
 * Stores snapshot only if stats have changed since the last snapshot
 *
 * Uses system API key via v2 API /user/battlestats endpoint
 */

import { startDbScheduledRunner } from "../lib/scheduler.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { logDuration, logError } from "../lib/logger.js";
import { tornApi } from "../services/torn-client.js";
import { executeSync } from "../lib/sync.js";
import { TABLE_NAMES } from "@sentinel/shared";
import type { TornApiOperations } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { randomUUID } from "crypto";

const WORKER_NAME = "battlestats_sync_worker";

/**
 * Fetch the most recent battlestats snapshot from the database
 */
async function getMostRecentSnapshot(): Promise<{
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
  total_stats: number;
} | null> {
  const db = getKysely();
  const data = await db
    .selectFrom(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
    .select(["strength", "speed", "defense", "dexterity", "total_stats"])
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();

  return (data ?? null) as {
    strength: number;
    speed: number;
    defense: number;
    dexterity: number;
    total_stats: number;
  } | null;
}

/**
 * Check if two battlestats objects are identical
 */
function isBattleStatsIdentical(
  stats1: {
    strength: number;
    speed: number;
    defense: number;
    dexterity: number;
    total_stats: number;
  },
  stats2: {
    strength: number;
    speed: number;
    defense: number;
    dexterity: number;
    total_stats: number;
  },
): boolean {
  return (
    stats1.strength === stats2.strength &&
    stats1.speed === stats2.speed &&
    stats1.defense === stats2.defense &&
    stats1.dexterity === stats2.dexterity &&
    stats1.total_stats === stats2.total_stats
  );
}

/**
 * Sync battlestats and store snapshot only if changed
 */
async function syncBattlestats(): Promise<void> {
  const startTime = Date.now();

  try {
    const apiKey = await getSystemApiKey("personal");

    // Fetch battlestats from Torn API
    const response = await tornApi.get<
      TornApiOperations["getMyBattlestats"]["responses"]["200"]["content"]["application/json"]
    >("/user/battlestats", { apiKey });

    // Extract battlestats from response (no type assertion needed - already typed)
    const battlestats = response.battlestats;
    if (!battlestats) {
      throw new Error("Missing battlestats in Torn response");
    }

    const strength = battlestats.strength.value || 0;
    const speed = battlestats.speed.value || 0;
    const defense = battlestats.defense.value || 0;
    const dexterity = battlestats.dexterity.value || 0;
    const totalStats = strength + speed + defense + dexterity;

    const newStats = {
      strength,
      speed,
      defense,
      dexterity,
      total_stats: totalStats,
    };

    // Get the most recent snapshot
    const recentSnapshot = await getMostRecentSnapshot();

    // If stats are identical to the most recent snapshot, skip insertion
    if (recentSnapshot && isBattleStatsIdentical(newStats, recentSnapshot)) {
      const duration = Date.now() - startTime;
      logDuration(
        WORKER_NAME,
        "Sync completed (no changes, skipped insert)",
        duration,
      );
      return;
    }

    // Insert new snapshot
    const db = getKysely();
    await db
      .insertInto(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
      .values({
        id: randomUUID(),
        strength: newStats.strength,
        speed: newStats.speed,
        defense: newStats.defense,
        dexterity: newStats.dexterity,
        total_stats: newStats.total_stats,
      })
      .execute();

    const duration = Date.now() - startTime;
    logDuration(
      WORKER_NAME,
      "Sync completed (inserted new snapshot)",
      duration,
    );
  } catch (error) {
    const elapsed = Date.now() - startTime;
    let errorMessage = "Unknown error";
    if (typeof error === "object" && error !== null && "message" in error) {
      errorMessage = (error as { message: string }).message;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = String(error);
    }
    const duration =
      elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(2)}s`;
    logError(
      WORKER_NAME,
      `Sync failed: ${errorMessage} (${new Date().toISOString()}) (${duration})`,
    );
    throw error;
  }
}

/**
 * Start the battlestats sync worker (takes snapshots every minute)
 */
export function startBattlestatsSyncWorker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 60, // Every minute
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 30000, // 30 seconds
        handler: syncBattlestats,
      });
    },
  });
}
