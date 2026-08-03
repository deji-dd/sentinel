import {
  Logger,
  getCrimeIdFromAction,
  extractCrimeDataPayload,
  calculateCrimeLogValue,
} from "@sentinel/utils";
import { db } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import { workerEvents } from "../../lib/event-bus.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "crimes_ledger";
const logger = new Logger(WORKER_NAME);

export const CRIME_LOG_IDS = [
  9010, 9015, 9020, 9025, 9027, 9030, 9050, 9051, 9052, 9053, 9055, 9056, 9060,
  9065, 9070, 9071, 9072, 9073, 9150, 9154, 9155, 9158, 9160, 9163, 9165, 9190,
  9191,
];

type UserLog = TornSchema<"UserLog">;

/**
 * Processes a single crime log safely into PostgreSQL `CrimeLog` (idempotent upsert).
 */
export async function processCrimeLog(log: UserLog): Promise<boolean> {
  const { action, nerve, innerData } = extractCrimeDataPayload(log.data);
  if (!action) return false;

  const customMapping = await db.crimeActionMapping.findUnique({
    where: { id: action.toLowerCase() },
  });
  const crimeId = customMapping
    ? customMapping.crimeId
    : getCrimeIdFromAction(action);
  const logValue = calculateCrimeLogValue(innerData);

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  await db.crimeLog.upsert({
    where: { id: logIdStr },
    update: {
      crimeId,
      action,
      nerve,
      value: logValue,
      timestamp: logTimestamp,
      updatedAt: new Date(),
    },
    create: {
      id: logIdStr,
      crimeId,
      action,
      nerve,
      value: logValue,
      timestamp: logTimestamp,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return true;
}

/**
 * High-performance on-demand aggregation query to fetch total nerve spent & value per crime category.
 */
export async function getCrimeTotals(crimeId?: number): Promise<
  Array<{
    crimeId: number;
    nerveSpent: number;
    totalValue: number;
    count: number;
  }>
> {
  const groups = await db.crimeLog.groupBy({
    by: ["crimeId"],
    where: crimeId !== undefined ? { crimeId } : undefined,
    _sum: { nerve: true, value: true },
    _count: { _all: true },
  });

  return groups.map((g) => ({
    crimeId: g.crimeId,
    nerveSpent: g._sum.nerve ?? 0,
    totalValue: g._sum.value ?? 0,
    count: g._count._all,
  }));
}

/**
 * Initializes Crimes Ledger V2:
 * 1. Replays all historical crime logs from PostgreSQL `PersonalLog` into `CrimeLog`.
 * 2. Updates `crimes_ledger_init` status to completed.
 */
export async function runCrimesLedgerInit(forceReplay = false): Promise<void> {
  if (!forceReplay) {
    const existingState = await db.systemState.findUnique({
      where: { id: "crimes_ledger_init" },
    });
    if (existingState && existingState.init) return;
  }

  logger.info("Starting Crimes Ledger V2 initialization...");

  try {
    // Verify log backfill is completed before initializing
    const backfillRecord = await db.systemState.findUnique({
      where: { id: "log_manager_backfill_progress" },
    });
    const backfillData = backfillRecord?.data as { status: string } | undefined;

    if (backfillData?.status !== "completed" && !forceReplay) {
      logger.warn(
        "Log backfill is still in progress. Postponing Crimes Ledger initialization.",
      );
      return;
    }

    // Mark init as in progress
    await db.systemState.upsert({
      where: { id: "crimes_ledger_init" },
      update: {
        init: false,
        data: { status: "in_progress" },
        updatedAt: new Date(),
      },
      create: {
        id: "crimes_ledger_init",
        init: false,
        data: { status: "in_progress" },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Replay all historical crime logs from PostgreSQL `PersonalLog`
    const [historicalLogs, customMappings] = await Promise.all([
      db.personalLog.findMany({
        where: { log: { in: CRIME_LOG_IDS } },
        orderBy: { timestamp: "asc" },
      }),
      db.crimeActionMapping.findMany(),
    ]);

    const customMappingMap = new Map<string, number>(
      customMappings.map((m) => [m.id.toLowerCase(), m.crimeId]),
    );

    logger.info(
      `Replaying ${historicalLogs.length} historical crime logs into CrimeLog...`,
    );

    let parsedCount = 0;
    const chunkSize = 200;
    for (let i = 0; i < historicalLogs.length; i += chunkSize) {
      const chunk = historicalLogs.slice(i, i + chunkSize);

      await db.$transaction(
        chunk.map((pLog) => {
          const { action, nerve, innerData } = extractCrimeDataPayload(
            pLog.data,
          );
          const actionKey = action.toLowerCase();
          const crimeId = customMappingMap.has(actionKey)
            ? customMappingMap.get(actionKey)!
            : getCrimeIdFromAction(action);
          const logValue = calculateCrimeLogValue(innerData);

          return db.crimeLog.upsert({
            where: { id: pLog.id },
            update: {
              crimeId,
              action,
              nerve,
              value: logValue,
              timestamp: pLog.timestamp,
              updatedAt: new Date(),
            },
            create: {
              id: pLog.id,
              crimeId,
              action,
              nerve,
              value: logValue,
              timestamp: pLog.timestamp,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }),
      );

      parsedCount += chunk.length;
    }

    // Mark Crimes Ledger initialization as complete
    await db.systemState.upsert({
      where: { id: "crimes_ledger_init" },
      update: {
        init: true,
        data: { status: "completed" },
        updatedAt: new Date(),
      },
      create: {
        id: "crimes_ledger_init",
        init: true,
        data: { status: "completed" },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info(
      `Crimes Ledger V2 initialized successfully! Replayed ${parsedCount} logs.`,
    );
  } catch (error) {
    logger.error("Failed to initialize Crimes Ledger:", error);
  }
}

/**
 * Setup real-time log event listener for crimes.
 */
export function startCrimesModule(_options?: WorkerStartOptions): void {
  workerEvents.on("new_log", async (log: UserLog) => {
    const initState = await db.systemState.findUnique({
      where: { id: "crimes_ledger_init" },
    });
    if (!initState || !initState.init) return;

    const logTypeCode = Number(log.details.id);
    if (CRIME_LOG_IDS.includes(logTypeCode)) {
      try {
        await processCrimeLog(log);
      } catch (err) {
        logger.error(`Error processing real-time crime log ${log.id}:`, err);
      }
    }
  });
}
