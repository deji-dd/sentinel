import { Logger } from "@sentinel/utils";
import { db, type Prisma } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import {
  tornApiManager,
  getPersonalKey,
  type StoredApiKey,
} from "@sentinel/torn-api-manager";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import { workerEvents } from "../../lib/event-bus.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "log_manager";
const logger = new Logger(WORKER_NAME);

type UserLogsResponse = TornSchema<"UserLogsResponse">;

type BackfillStateData = {
  status: "in_progress" | "completed";
  logsParsed: number;
  oldestTimestampReached: number | null;
};

const REQUIRED_MODULE_INITS = [
  "crimes_ledger_init",
  "gym_ledger_init",
  "stock_ledger_init",
  "wealth_ledger_init",
  "travel_ledger_init",
] as const;

/**
 * High-speed burst historical backfill loop.
 * Fetches up to `burstPages` (1,000 logs total per cycle) with 150ms delay between pages.
 */
async function runBurstHistoricalBackfill(
  keyEntry: StoredApiKey,
): Promise<void> {
  const stateRecord = await db.systemState.findUnique({
    where: { id: "log_manager_backfill_progress" },
  });

  const stateData: BackfillStateData =
    (stateRecord?.data as unknown as BackfillStateData) || {
      status: "in_progress",
      logsParsed: 0,
      oldestTimestampReached: null,
    };

  if (stateData.status === "completed") return;

  let currentTo = stateData.oldestTimestampReached ?? undefined;
  let totalParsed = stateData.logsParsed;
  let oldestInBatch = currentTo ?? Math.floor(Date.now() / 1000);

  const burstPages = 10;
  logger.info(
    `Starting burst backfill (up to ${burstPages * 100} logs, starting to=${currentTo ?? "latest"})...`,
  );

  for (let page = 0; page < burstPages; page++) {
    const queryParams: { limit: number; to?: number } = { limit: 100 };
    if (currentTo) queryParams.to = currentTo;

    const res = (await tornApiManager.get("/user/log", {
      apiKey: keyEntry.apiKey,
      userId: keyEntry.userId,
      queryParams,
    })) as UserLogsResponse;

    const logs = res.log || [];
    if (logs.length === 0) {
      logger.info("Reached end of log history. Backfill completed!");
      await db.systemState.upsert({
        where: { id: "log_manager_backfill_progress" },
        update: {
          data: {
            status: "completed",
            logsParsed: totalParsed,
            oldestTimestampReached: oldestInBatch,
          },
          updatedAt: new Date(),
        },
        create: {
          id: "log_manager_backfill_progress",
          init: true,
          data: {
            status: "completed",
            logsParsed: totalParsed,
            oldestTimestampReached: oldestInBatch,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      workerEvents.emit("log_backfill_completed");
      workerEvents.emit("settings_updated");
      return;
    }

    await db.$transaction(
      logs.map((log) => {
        const logIdStr = String(log.id);
        const logDetails = (log as any).details || {};
        const logTypeCode = logDetails.id ?? 0;
        const titleStr = logDetails.title ?? null;
        const categoryStr = logDetails.category ?? null;
        const logJson = log as unknown as Prisma.InputJsonValue;

        return db.personalLog.upsert({
          where: { id: logIdStr },
          update: {
            log: logTypeCode,
            title: titleStr,
            timestamp: new Date(log.timestamp * 1000),
            category: categoryStr,
            data: logJson,
            updatedAt: new Date(),
          },
          create: {
            id: logIdStr,
            log: logTypeCode,
            title: titleStr,
            timestamp: new Date(log.timestamp * 1000),
            category: categoryStr,
            data: logJson,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }),
      { timeout: 30000 },
    );

    for (const log of logs) {
      totalParsed++;
      if (log.timestamp < oldestInBatch) {
        oldestInBatch = log.timestamp;
      }
      workerEvents.emit("new_log", log);
    }

    currentTo = oldestInBatch;

    await db.systemState.upsert({
      where: { id: "log_manager_backfill_progress" },
      update: {
        data: {
          status: "in_progress",
          logsParsed: totalParsed,
          oldestTimestampReached: oldestInBatch,
        },
        updatedAt: new Date(),
      },
      create: {
        id: "log_manager_backfill_progress",
        init: true,
        data: {
          status: "in_progress",
          logsParsed: totalParsed,
          oldestTimestampReached: oldestInBatch,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const readableDate = new Date(oldestInBatch * 1000)
      .toISOString()
      .split("T")[0];
    logger.info(
      `Backfill progress: Parsed ${totalParsed} logs. Oldest reached: ${readableDate}`,
    );

    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * Real-time polling for new personal logs.
 */
async function syncLogs(): Promise<void> {
  const finishSync = logger.time();

  try {
    const keyEntry = await getPersonalKey();
    if (!keyEntry) {
      logger.warn("No personal API key available for log manager. Skipping.");
      return;
    }

    // 1. Check if backfill is still in progress
    const backfillRecord = await db.systemState.findUnique({
      where: { id: "log_manager_backfill_progress" },
    });
    const backfillData = backfillRecord?.data as unknown as
      | BackfillStateData
      | undefined;

    if (!backfillData || backfillData.status === "in_progress") {
      await runBurstHistoricalBackfill(keyEntry);
      finishSync();
      return;
    }

    // 2. Guard: Verify all required ledger module inits have completed before real-time forward polling
    const pendingInits: string[] = [];
    for (const initId of REQUIRED_MODULE_INITS) {
      const rec = await db.systemState.findUnique({ where: { id: initId } });
      if (!rec || !rec.init) {
        pendingInits.push(initId);
      }
    }

    if (pendingInits.length > 0) {
      logger.warn(
        `Postponing real-time log polling. Inits still ongoing: ${pendingInits.join(", ")}`,
      );
      finishSync();
      return;
    }

    // 3. Real-time polling mode
    const stateRecord = await db.systemState.findUnique({
      where: { id: "log_manager_last_checked" },
    });
    const lastChecked =
      (stateRecord?.data as { timestamp: number } | undefined)?.timestamp ??
      Math.floor(Date.now() / 1000) - 3600;

    const res = (await tornApiManager.get("/user/log", {
      apiKey: keyEntry.apiKey,
      userId: keyEntry.userId,
      queryParams: { from: lastChecked, limit: 100 },
    })) as UserLogsResponse;

    const logs = res.log || [];
    let maxTimestamp = lastChecked;

    if (logs.length > 0) {
      await db.$transaction(
        logs.map((log) => {
          const logIdStr = String(log.id);
          const logDetails = (log as any).details || {};
          const logTypeCode = logDetails.id ?? 0;
          const titleStr = logDetails.title ?? null;
          const categoryStr = logDetails.category ?? null;
          const logJson = log as unknown as Prisma.InputJsonValue;

          return db.personalLog.upsert({
            where: { id: logIdStr },
            update: {
              log: logTypeCode,
              title: titleStr,
              timestamp: new Date(log.timestamp * 1000),
              category: categoryStr,
              data: logJson,
              updatedAt: new Date(),
            },
            create: {
              id: logIdStr,
              log: logTypeCode,
              title: titleStr,
              timestamp: new Date(log.timestamp * 1000),
              category: categoryStr,
              data: logJson,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }),
        { timeout: 30000 },
      );

      for (const log of logs) {
        maxTimestamp = Math.max(maxTimestamp, log.timestamp);
        workerEvents.emit("new_log", log);
      }

      await db.systemState.upsert({
        where: { id: "log_manager_last_checked" },
        update: { data: { timestamp: maxTimestamp }, updatedAt: new Date() },
        create: {
          id: "log_manager_last_checked",
          data: { timestamp: maxTimestamp },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      logger.info(`Synced ${logs.length} new personal logs.`);
    }

    finishSync();
  } catch (error) {
    logger.error("Failed to execute log sync:", error);
  }
}

/**
 * Manual range re-sync function for manual historical repair or testing.
 */
export async function resyncLogsRange(
  from: number,
  to: number,
): Promise<{ fetched: number; newLogs: number }> {
  const keyEntry = await getPersonalKey();
  if (!keyEntry) throw new Error("No personal API key available.");

  logger.info(`Manual resync requested for range: ${from} to ${to}`);
  let currentFrom = from;
  let totalFetched = 0;
  let totalNew = 0;

  while (currentFrom < to) {
    const res = (await tornApiManager.get("/user/log", {
      apiKey: keyEntry.apiKey,
      userId: keyEntry.userId,
      queryParams: { from: currentFrom, to, limit: 100 },
    })) as UserLogsResponse;

    const logs = res.log || [];
    if (logs.length === 0) break;

    totalFetched += logs.length;
    let maxTimestamp = currentFrom;

    await db.$transaction(
      logs.map((log) => {
        const logIdStr = String(log.id);
        const logDetails = (log as any).details || {};
        const logTypeCode = logDetails.id ?? 0;
        const titleStr = logDetails.title ?? null;
        const categoryStr = logDetails.category ?? null;
        const logJson = log as unknown as Prisma.InputJsonValue;

        return db.personalLog.upsert({
          where: { id: logIdStr },
          update: {
            log: logTypeCode,
            title: titleStr,
            timestamp: new Date(log.timestamp * 1000),
            category: categoryStr,
            data: logJson,
            updatedAt: new Date(),
          },
          create: {
            id: logIdStr,
            log: logTypeCode,
            title: titleStr,
            timestamp: new Date(log.timestamp * 1000),
            category: categoryStr,
            data: logJson,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }),
      { timeout: 30000 },
    );

    for (const log of logs) {
      maxTimestamp = Math.max(maxTimestamp, log.timestamp);
      totalNew++;
      workerEvents.emit("new_log", log);
    }

    if (maxTimestamp <= currentFrom) break;
    currentFrom = maxTimestamp + 1;
  }

  logger.info(
    `Manual resync complete for range ${from}-${to}. Fetched: ${totalFetched}, New: ${totalNew}`,
  );
  return { fetched: totalFetched, newLogs: totalNew };
}

/**
 * Initializes and starts the log manager private background worker.
 */
export function startLogManager(options?: WorkerStartOptions): void {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 60,
    initialDelayMs: options?.initialDelayMs,
    handler: syncLogs,
  });
}
