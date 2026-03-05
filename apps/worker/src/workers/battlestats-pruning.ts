/**
 * Battlestats snapshots pruning worker
 * Runs weekly on Sundays to remove intra-day fluctuations older than 30 days
 * Preserves only the final snapshot for each day older than 30 days
 *
 * Logic:
 * 1. Skip if not Sunday (UTC)
 * 2. Find all snapshots older than 30 days
 * 3. Group by day
 * 4. For each day, keep the latest snapshot and delete all others
 */

import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { logDuration, logError } from "../lib/logger.js";
import { executeSync } from "../lib/sync.js";
import { TABLE_NAMES } from "@sentinel/shared";

const WORKER_NAME = "battlestats_pruning_worker";
const RETENTION_DAYS = 30;

/**
 * Prune battlestats snapshots by removing intra-day fluctuations older than 30 days
 * Keeps only the final snapshot for each older day
 * Only runs on Sundays
 */
async function pruneBattlestats(): Promise<void> {
  const startTime = Date.now();

  try {
    // Only run on Sundays (UTC)
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    if (dayOfWeek !== 0) {
      // 0 = Sunday; skip if not Sunday
      return;
    }

    // Calculate cutoff date (30 days ago)
    const cutoffDate = new Date();
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - RETENTION_DAYS);
    cutoffDate.setUTCHours(0, 0, 0, 0);

    // Fetch all snapshots older than cutoff
    const { data: oldSnapshots, error: fetchError } = await supabase
      .from(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
      .select("id, created_at")
      .lt("created_at", cutoffDate.toISOString())
      .order("created_at", { ascending: false });

    if (fetchError) {
      throw new Error(`Failed to fetch old snapshots: ${fetchError.message}`);
    }

    if (!oldSnapshots || oldSnapshots.length === 0) {
      const duration = Date.now() - startTime;
      logDuration(
        WORKER_NAME,
        "Prune completed (no old snapshots to process)",
        duration,
      );
      return;
    }

    // Group snapshots by day
    const snapshotsByDay = new Map<string, string[]>();

    for (const snapshot of oldSnapshots) {
      const dayKey = (snapshot.created_at as string).split("T")[0];
      if (!snapshotsByDay.has(dayKey)) {
        snapshotsByDay.set(dayKey, []);
      }
      snapshotsByDay.get(dayKey)!.push(snapshot.id as string);
    }

    // For each day, keep only the latest snapshot and delete the rest
    let totalDeleted = 0;

    for (const [, snapshotIds] of snapshotsByDay) {
      if (snapshotIds.length <= 1) {
        continue; // Only one snapshot for this day, nothing to prune
      }

      // Keep the first one (latest, due to descending sort), delete the rest
      const toDelete = snapshotIds.slice(1);

      const { error: deleteError } = await supabase
        .from(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
        .delete()
        .in("id", toDelete);

      if (deleteError) {
        throw new Error(
          `Failed to delete old battlestats snapshots: ${deleteError.message}`,
        );
      }

      totalDeleted += toDelete.length;
    }

    const duration = Date.now() - startTime;
    logDuration(
      WORKER_NAME,
      `Prune completed (deleted ${totalDeleted} intra-day snapshots older than ${RETENTION_DAYS} days)`,
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
      `Prune failed: ${errorMessage} (${new Date().toISOString()}) (${duration})`,
    );
    throw error;
  }
}

/**
 * Start the battlestats pruning worker
 * Runs weekly (checks every hour, executes on Sundays only)
 */
export function startBattlestatsPruningWorker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 3600, // Check every hour, but only execute on Sundays
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 60000, // 60 seconds
        handler: pruneBattlestats,
      });
    },
  });
}
