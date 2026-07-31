import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { ensureFactionsTracked } from "../../lib/faction-tracker.js";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "faction_sync";
const logger = new Logger(WORKER_NAME);

/**
 * Sweeps all registered territory states and war ledgers to ensure faction data
 * is fully populated and refreshed if older than 24 hours.
 */
export async function runFactionSync(): Promise<void> {
  const finishLog = logger.time();

  try {
    const states = await db.territoryState.findMany({
      select: { factionId: true },
    });
    const wars = await db.warLedger.findMany({
      select: { assaultingFaction: true, defendingFaction: true, victorFaction: true },
    });

    const allFactionIds: (number | null | undefined)[] = [
      ...states.map((s) => s.factionId),
      ...wars.flatMap((w) => [w.assaultingFaction, w.defendingFaction, w.victorFaction]),
    ];

    const updatedCount = await ensureFactionsTracked(allFactionIds);
    logger.info(`Faction sync completed. Refreshed ${updatedCount} factions.`);

    finishLog();
  } catch (error) {
    logger.error("Failed to execute faction sync:", error);
  }
}

/**
 * Starts the daily faction sync worker.
 */
export function startFactionSync(options?: WorkerStartOptions): void {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 86400, // 24 hours
    initialDelayMs: options?.initialDelayMs,
    handler: runFactionSync,
  });
}
