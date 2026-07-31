import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import { workerEvents } from "../../lib/event-bus.js";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "gym_ledger";
const logger = new Logger(WORKER_NAME);

export type StatType = "strength" | "defense" | "speed" | "dexterity";

export const GYM_TRAIN_LOG_IDS = [5300, 5301, 5302, 5303];
export const STAT_ENHANCER_LOG_IDS = [2120, 2130, 2140, 2150];
export const BOOK_LOG_IDS = [2052, 2053, 2054, 2055];
export const COMPANY_LOG_IDS = [6526, 6527, 6528, 6529];

export const STAT_GAIN_LOG_IDS = [
  ...GYM_TRAIN_LOG_IDS,
  ...STAT_ENHANCER_LOG_IDS,
  ...BOOK_LOG_IDS,
  ...COMPANY_LOG_IDS,
];

type UserLog = TornSchema<"UserLog">;

/**
 * Extract stat gain details, before stats, and after stats from log payload.
 */
export function parseStatGainFromLog(log: UserLog | any): {
  statType: StatType;
  statGained: number;
  statBefore?: number;
  statAfter?: number;
  source: "gym" | "item" | "book" | "company";
  trains?: number;
  energyUsed?: number;
} | null {
  const data = log?.data || {};

  let statType: StatType | null = null;
  let statGained = 0;
  let statBefore: number | undefined;
  let statAfter: number | undefined;

  if (data.strength_increased) {
    statType = "strength";
    statGained = Number(data.strength_increased);
    if (data.strength_before !== undefined) statBefore = Number(data.strength_before);
    if (data.strength_after !== undefined) statAfter = Number(data.strength_after);
  } else if (data.defense_increased) {
    statType = "defense";
    statGained = Number(data.defense_increased);
    if (data.defense_before !== undefined) statBefore = Number(data.defense_before);
    if (data.defense_after !== undefined) statAfter = Number(data.defense_after);
  } else if (data.speed_increased) {
    statType = "speed";
    statGained = Number(data.speed_increased);
    if (data.speed_before !== undefined) statBefore = Number(data.speed_before);
    if (data.speed_after !== undefined) statAfter = Number(data.speed_after);
  } else if (data.dexterity_increased) {
    statType = "dexterity";
    statGained = Number(data.dexterity_increased);
    if (data.dexterity_before !== undefined) statBefore = Number(data.dexterity_before);
    if (data.dexterity_after !== undefined) statAfter = Number(data.dexterity_after);
  }

  if (!statType || statGained <= 0) return null;

  const logTypeCode = Number((log as any).details?.id ?? log.log ?? 0);
  let source: "gym" | "item" | "book" | "company" = "gym";

  if (STAT_ENHANCER_LOG_IDS.includes(logTypeCode)) {
    source = "item";
  } else if (BOOK_LOG_IDS.includes(logTypeCode)) {
    source = "book";
  } else if (COMPANY_LOG_IDS.includes(logTypeCode)) {
    source = "company";
  }

  return {
    statType,
    statGained,
    statBefore,
    statAfter,
    source,
    trains: data.trains ? Number(data.trains) : undefined,
    energyUsed: data.energy_used ? Number(data.energy_used) : undefined,
  };
}

/**
 * Processes a single stat gain log safely into PostgreSQL `GymLedger` (idempotent upsert).
 */
export async function processGymLog(log: UserLog): Promise<boolean> {
  const parsed = parseStatGainFromLog(log);
  if (!parsed) return false;

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  await db.gymLedger.upsert({
    where: { id: logIdStr },
    update: {
      timestamp: logTimestamp,
      statType: parsed.statType,
      source: parsed.source,
      trains: parsed.trains ?? null,
      energyUsed: parsed.energyUsed ?? null,
      statGained: parsed.statGained,
      statBefore: parsed.statBefore ?? null,
      statAfter: parsed.statAfter ?? null,
      updatedAt: new Date(),
    },
    create: {
      id: logIdStr,
      timestamp: logTimestamp,
      statType: parsed.statType,
      source: parsed.source,
      trains: parsed.trains ?? null,
      energyUsed: parsed.energyUsed ?? null,
      statGained: parsed.statGained,
      statBefore: parsed.statBefore ?? null,
      statAfter: parsed.statAfter ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return true;
}

/**
 * Initializes Gym Ledger V2:
 * 1. Checks if historical log backfill is completed.
 * 2. Replays all historical gym logs from PostgreSQL `PersonalLog`.
 * 3. Updates `gym_ledger_v2_init` status to completed.
 */
async function runGymLedgerInit(): Promise<void> {
  logger.info("Starting Gym Ledger V2 initialization...");

  try {
    // 1. Verify log backfill is completed before initializing
    const backfillRecord = await db.systemState.findUnique({
      where: { id: "log_manager_backfill_progress" },
    });
    const backfillData = backfillRecord?.data as { status: string } | undefined;

    if (backfillData?.status !== "completed") {
      logger.warn("Log backfill is still in progress. Postponing Gym Ledger initialization.");
      return;
    }

    // Mark init as in progress
    await db.systemState.upsert({
      where: { id: "gym_ledger_init" },
      update: { init: false, data: { status: "in_progress" }, updatedAt: new Date() },
      create: { id: "gym_ledger_init", init: false, data: { status: "in_progress" }, createdAt: new Date(), updatedAt: new Date() },
    });

    // 2. Replay all historical gym logs from PostgreSQL `PersonalLog`
    const historicalLogs = await db.personalLog.findMany({
      where: { log: { in: STAT_GAIN_LOG_IDS } },
      orderBy: { timestamp: "asc" },
    });

    logger.info(`Replaying ${historicalLogs.length} historical gym logs...`);

    let parsedCount = 0;
    // Process in transaction chunks of 200 items for high performance
    const chunkSize = 200;
    for (let i = 0; i < historicalLogs.length; i += chunkSize) {
      const chunk = historicalLogs.slice(i, i + chunkSize);

      await db.$transaction(
        chunk.map((pLog) => {
          const logData = pLog.data as any;
          const parsed = parseStatGainFromLog({
            ...logData,
            id: pLog.id,
            log: pLog.log,
            timestamp: Math.floor(pLog.timestamp.getTime() / 1000),
          });

          if (!parsed) {
            return db.gymLedger.findUnique({ where: { id: pLog.id } });
          }

          return db.gymLedger.upsert({
            where: { id: pLog.id },
            update: {
              timestamp: pLog.timestamp,
              statType: parsed.statType,
              source: parsed.source,
              trains: parsed.trains ?? null,
              energyUsed: parsed.energyUsed ?? null,
              statGained: parsed.statGained,
              statBefore: parsed.statBefore ?? null,
              statAfter: parsed.statAfter ?? null,
              updatedAt: new Date(),
            },
            create: {
              id: pLog.id,
              timestamp: pLog.timestamp,
              statType: parsed.statType,
              source: parsed.source,
              trains: parsed.trains ?? null,
              energyUsed: parsed.energyUsed ?? null,
              statGained: parsed.statGained,
              statBefore: parsed.statBefore ?? null,
              statAfter: parsed.statAfter ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }),
      );

      parsedCount += chunk.length;
    }

    // 3. Mark Gym Ledger initialization as complete
    await db.systemState.upsert({
      where: { id: "gym_ledger_init" },
      update: { init: true, data: { status: "completed" }, updatedAt: new Date() },
      create: { id: "gym_ledger_init", init: true, data: { status: "completed" }, createdAt: new Date(), updatedAt: new Date() },
    });

    logger.info(`Gym Ledger V2 initialized successfully! Replayed ${parsedCount} logs.`);
  } catch (error) {
    logger.error("Failed to initialize Gym Ledger:", error);
  }
}

/**
 * Runner handler to check and trigger initialization if needed.
 */
async function checkAndRunGymModule(): Promise<void> {
  const initState = await db.systemState.findUnique({
    where: { id: "gym_ledger_init" },
  });

  if (!initState || !initState.init) {
    await runGymLedgerInit();
  }
}

/**
 * Setup real-time log event listener & register background module.
 */
export function startGymModule(options?: WorkerStartOptions): void {
  // Listen for real-time new logs arriving from log-manager
  workerEvents.on("new_log", async (log: UserLog) => {
    const logTypeCode = Number(log.details.id);
    if (STAT_GAIN_LOG_IDS.includes(logTypeCode)) {
      try {
        await processGymLog(log);
      } catch (err) {
        logger.error(`Error processing real-time gym log ${log.id}:`, err);
      }
    }
  });

  // Listen for backfill completed event to auto-trigger init
  workerEvents.on("settings_updated", () => {
    checkAndRunGymModule().catch((err) =>
      logger.error("Error running Gym Module after settings update:", err),
    );
  });

  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 3600, // Sweep check once per hour
    initialDelayMs: options?.initialDelayMs,
    handler: checkAndRunGymModule,
  });
}
