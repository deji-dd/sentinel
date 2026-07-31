import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import { workerEvents } from "../../lib/event-bus.js";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "crimes_ledger";
const logger = new Logger(WORKER_NAME);

export const CRIME_LOG_IDS = [
  9010, 9015, 9020, 9025, 9027, 9030, 9050, 9051, 9052, 9053, 9055, 9056,
  9060, 9065, 9070, 9071, 9072, 9073, 9150, 9154, 9155, 9158, 9160, 9163,
  9165, 9190, 9191,
];

type UserLog = TornSchema<"UserLog">;

/**
 * Maps a crime action string to its numeric Crime ID (1-13).
 */
export function getCrimeIdFromAction(action: string): number {
  const lower = action.toLowerCase().trim();
  if (!lower) return 0;

  if (
    lower.includes("search") ||
    lower.includes("trash") ||
    lower.includes("subway") ||
    lower.includes("junkyard") ||
    lower.includes("beach") ||
    lower.includes("cemetery") ||
    lower.includes("fountain")
  ) {
    return 1;
  } else if (
    lower.includes("dvd") ||
    lower.includes("bootleg") ||
    lower.includes("online store")
  ) {
    return 2;
  } else if (lower.includes("graffiti")) {
    return 3;
  } else if (lower.includes("shoplift")) {
    return 4;
  } else if (lower.includes("pickpocket")) {
    return 5;
  } else if (
    lower.includes("skim") ||
    lower.includes("atm") ||
    lower.includes("gas pump") ||
    lower.includes("train station") ||
    lower.includes("subway") ||
    lower.includes("cash register")
  ) {
    return 6;
  } else if (
    lower.includes("burgle") ||
    lower.includes("burgling") ||
    lower.includes("burglary") ||
    lower.includes("casing") ||
    lower.includes("scouting for an industrial burglary") ||
    lower.includes("brewery") ||
    lower.includes("truckyard") ||
    lower.includes("foundry")
  ) {
    return 7;
  } else if (
    lower.includes("hustle") ||
    lower.includes("hustling") ||
    lower.includes("shell game") ||
    lower.includes("street hustle")
  ) {
    return 8;
  } else if (
    lower.includes("dispose") ||
    lower.includes("disposal") ||
    lower.includes("body") ||
    lower.includes("discard") ||
    lower.includes("abandoning") ||
    lower.includes("burying") ||
    lower.includes("burning") ||
    lower.includes("sinking")
  ) {
    return 9;
  } else if (
    lower.includes("crack") ||
    lower.includes("cracking") ||
    lower.includes("safe") ||
    lower.includes("vault")
  ) {
    return 10;
  } else if (
    lower.includes("forge") ||
    lower.includes("forgery") ||
    lower.includes("project") ||
    lower.includes("step #") ||
    lower.includes("drafting") ||
    lower.includes("signing") ||
    lower.includes("printing") ||
    lower.includes("laminating") ||
    lower.includes("cutting") ||
    lower.includes("perforating") ||
    lower.includes("painting") ||
    lower.includes("trimming") ||
    lower.includes("stacking & folding") ||
    lower.includes("sewing") ||
    lower.includes("gluing") ||
    lower.includes("checking") ||
    lower.includes("embossing")
  ) {
    return 11;
  } else if (lower.includes("scam") || lower.includes("spam")) {
    return 12;
  } else if (
    lower.includes("rob") ||
    lower.includes("robbery") ||
    lower.includes("inquire") ||
    lower.includes("make entry") ||
    lower.includes("plant evidence") ||
    lower.includes("place combustible") ||
    lower.includes("ignite fire") ||
    lower.includes("stoke fire") ||
    lower.includes("dampen fire") ||
    lower.includes("collect") ||
    lower.includes("breaching") ||
    lower.includes("combustible") ||
    lower.includes("igniting") ||
    lower.includes("dampening") ||
    lower.includes("stoking")
  ) {
    return 13;
  }

  return 0;
}

/**
 * Calculates net monetary value gained/lost in a crime event payload.
 */
export function calculateCrimeLogValue(data: any): number {
  if (!data) return 0;
  let total = 0;

  if (data.money_gained) total += Number(data.money_gained);
  if (data.money_lost) total -= Number(data.money_lost);

  if (data.items_gained && typeof data.items_gained === "object") {
    for (const [, qty] of Object.entries(data.items_gained)) {
      total += Number(qty || 0) * 1000;
    }
  }

  if (data.items_lost && typeof data.items_lost === "object") {
    for (const [, qty] of Object.entries(data.items_lost)) {
      total -= Number(qty || 0) * 1000;
    }
  }

  return total;
}

/**
 * Processes a single crime log safely into PostgreSQL `CrimeLog` (idempotent upsert).
 */
export async function processCrimeLog(log: UserLog): Promise<boolean> {
  const data = (log.data as Record<string, any>) || {};
  if (!data.crime_action) return false;

  const crimeAction = String(data.crime_action);
  const crimeId = getCrimeIdFromAction(crimeAction);
  const logValue = calculateCrimeLogValue(data);
  const nerveSpent = Number(data.nerve || 0);

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  await db.crimeLog.upsert({
    where: { id: logIdStr },
    update: {
      crimeId,
      action: crimeAction,
      nerve: nerveSpent,
      value: logValue,
      timestamp: logTimestamp,
      updatedAt: new Date(),
    },
    create: {
      id: logIdStr,
      crimeId,
      action: crimeAction,
      nerve: nerveSpent,
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
  Array<{ crimeId: number; nerveSpent: number; totalValue: number; count: number }>
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
 * 1. Checks if historical log backfill is completed.
 * 2. Replays all historical crime logs from PostgreSQL `PersonalLog` into `CrimeLog`.
 * 3. Updates `crimes_ledger_v2_init` status to completed.
 */
async function runCrimesLedgerInit(): Promise<void> {
  logger.info("Starting Crimes Ledger V2 initialization...");

  try {
    // 1. Verify log backfill is completed before initializing
    const backfillRecord = await db.systemState.findUnique({
      where: { id: "log_manager_backfill_progress" },
    });
    const backfillData = backfillRecord?.data as { status: string } | undefined;

    if (backfillData?.status !== "completed") {
      logger.warn("Log backfill is still in progress. Postponing Crimes Ledger initialization.");
      return;
    }

    // Mark init as in progress
    await db.systemState.upsert({
      where: { id: "crimes_ledger_init" },
      update: { init: false, data: { status: "in_progress" }, updatedAt: new Date() },
      create: { id: "crimes_ledger_init", init: false, data: { status: "in_progress" }, createdAt: new Date(), updatedAt: new Date() },
    });

    // 2. Replay all historical crime logs from PostgreSQL `PersonalLog`
    const historicalLogs = await db.personalLog.findMany({
      where: { log: { in: CRIME_LOG_IDS } },
      orderBy: { timestamp: "asc" },
    });

    logger.info(`Replaying ${historicalLogs.length} historical crime logs into CrimeLog...`);

    let parsedCount = 0;
    const chunkSize = 200;
    for (let i = 0; i < historicalLogs.length; i += chunkSize) {
      const chunk = historicalLogs.slice(i, i + chunkSize);

      await db.$transaction(
        chunk.map((pLog) => {
          const logData = pLog.data as any;
          const crimeAction = String(logData.crime_action || "");
          const crimeId = getCrimeIdFromAction(crimeAction);
          const logValue = calculateCrimeLogValue(logData);
          const nerveSpent = Number(logData.nerve || 0);

          return db.crimeLog.upsert({
            where: { id: pLog.id },
            update: {
              crimeId,
              action: crimeAction,
              nerve: nerveSpent,
              value: logValue,
              timestamp: pLog.timestamp,
              updatedAt: new Date(),
            },
            create: {
              id: pLog.id,
              crimeId,
              action: crimeAction,
              nerve: nerveSpent,
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

    // 3. Mark Crimes Ledger initialization as complete
    await db.systemState.upsert({
      where: { id: "crimes_ledger_init" },
      update: { init: true, data: { status: "completed" }, updatedAt: new Date() },
      create: { id: "crimes_ledger_init", init: true, data: { status: "completed" }, createdAt: new Date(), updatedAt: new Date() },
    });

    logger.info(`Crimes Ledger V2 initialized successfully! Replayed ${parsedCount} logs.`);
  } catch (error) {
    logger.error("Failed to initialize Crimes Ledger:", error);
  }
}

/**
 * Runner handler to check and trigger initialization if needed.
 */
async function checkAndRunCrimesModule(): Promise<void> {
  const initState = await db.systemState.findUnique({
    where: { id: "crimes_ledger_init" },
  });

  if (!initState || !initState.init) {
    await runCrimesLedgerInit();
  }
}

/**
 * Setup real-time log event listener & register background module.
 */
export function startCrimesModule(options?: WorkerStartOptions): void {
  // Listen for real-time new logs arriving from log-manager
  workerEvents.on("new_log", async (log: UserLog) => {
    const logTypeCode = Number(log.details.id);
    if (CRIME_LOG_IDS.includes(logTypeCode)) {
      try {
        await processCrimeLog(log);
      } catch (err) {
        logger.error(`Error processing real-time crime log ${log.id}:`, err);
      }
    }
  });

  // Listen for backfill completed event to auto-trigger init
  workerEvents.on("settings_updated", () => {
    checkAndRunCrimesModule().catch((err) =>
      logger.error("Error running Crimes Module after settings update:", err),
    );
  });

  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 3600, // Sweep check once per hour
    initialDelayMs: options?.initialDelayMs,
    handler: checkAndRunCrimesModule,
  });
}
