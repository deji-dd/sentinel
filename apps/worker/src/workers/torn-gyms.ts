/* eslint-disable @typescript-eslint/no-explicit-any, no-empty */
import { executeSync } from "../lib/sync.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { Logger } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

const GYM_WORKER_NAME = "torn_gyms_worker";
const gymLogger = new Logger(GYM_WORKER_NAME);

async function saveLogBatch(db: any, logs: any[]): Promise<number> {
  let inserted = 0;
  for (const log of logs) {
    const logId = String(log.id);
    const timestamp = Number(log.timestamp);
    const details = log.details || {};
    
    const logIdNum = details.id ? Number(details.id) : 0;
    if (logIdNum === 5320) {
      const data = log.data || {};
      const gymId = data.gym ? parseInt(String(data.gym), 10) : null;
      if (gymId) {
        await db
          .updateTable(TABLE_NAMES.TORN_GYMS)
          .set({ unlocked: 1 })
          .where("id", "=", gymId)
          .execute();
        inserted++;
      }
      continue;
    }

    const title = String(details.title || "");
    const isTrainLog = title.toLowerCase().startsWith("gym train");
    if (!isTrainLog) continue;

    const data = log.data || {};
    const statMatch = title.match(/gym train (strength|defense|speed|dexterity)/i);
    if (!statMatch) continue;
    const stat = statMatch[1].toLowerCase();

    const gain = parseFloat(String(data[`${stat}_increased`] || "0"));
    const energy = parseInt(String(data.energy_used || 0), 10);
    const happy = parseInt(String(data.happy_used || 0), 10);
    const gymId = data.gym ? parseInt(String(data.gym), 10) : null;

    if (!stat || isNaN(gain) || gain <= 0) continue;

    await db
      .insertInto(TABLE_NAMES.GYM_TRAIN_LOGS as any)
      .values({
        log_id: logId,
        timestamp,
        stat,
        gain,
        energy,
        happy,
        gym_id: gymId,
      })
      .onConflict((oc: any) => oc.column("log_id").doNothing())
      .execute();

    inserted++;
  }
  return inserted;
}

export async function syncGymTrainLogs(): Promise<void> {
  const apiKey = await getSystemApiKey("personal");
  const db = getKysely();

  // Find the latest timestamp in sentinel_gym_train_logs
  const latestLog = await db
    .selectFrom(TABLE_NAMES.GYM_TRAIN_LOGS as any)
    .select("timestamp")
    .orderBy("timestamp", "desc")
    .limit(1)
    .executeTakeFirst();

  let fromTimestamp = latestLog ? Number(latestLog.timestamp) : 0;
  const toTimestamp = Math.floor(Date.now() / 1000);

  gymLogger.info(`Starting gym logs forward sync. Checking from timestamp ${fromTimestamp} to ${toTimestamp}...`);

  let countNewLogs = 0;

  // 1. Forward sync batch loop (fetching newer logs since last sync)
  let forwardHasMore = true;
  let currentForwardTo = toTimestamp;
  let forwardPages = 0;
  const MAX_FORWARD_PAGES = 20; // safe maximum pages to query per run

  while (forwardHasMore && forwardPages < MAX_FORWARD_PAGES) {
    try {
      gymLogger.info(`Fetching forward logs page ${forwardPages + 1} (to: ${currentForwardTo}, from: ${fromTimestamp})...`);
      const response = (await tornApi.get("/user/log" as any, {
        apiKey,
        queryParams: {
          cat: "125",
          from: String(fromTimestamp),
          to: String(currentForwardTo),
          limit: "100",
        },
      })) as any;

      const logs = response.log;
      if (!logs || !Array.isArray(logs) || logs.length === 0) {
        gymLogger.info("No more new forward log entries found on this page.");
        forwardHasMore = false;
        break;
      }

      gymLogger.debug(`Fetched forward batch of ${logs.length} log entries.`);
      const inserted = await saveLogBatch(db, logs);
      countNewLogs += inserted;

      if (logs.length < 100) {
        gymLogger.info("Fetched last forward page of new logs.");
        forwardHasMore = false;
      } else {
        const oldestInBatch = logs[logs.length - 1];
        const oldestTimestamp = Number(oldestInBatch.timestamp);
        if (oldestTimestamp <= fromTimestamp) {
          forwardHasMore = false;
        } else {
          currentForwardTo = oldestTimestamp - 1;
        }
      }

      forwardPages++;
      if (forwardHasMore && forwardPages < MAX_FORWARD_PAGES) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (apiError) {
      gymLogger.error("Failed forward syncing logs page from Torn API", apiError);
      forwardHasMore = false;
    }
  }

  // 2. Backward backfill loop (fetching older logs to sync complete historical profile)
  const scheduleRow = await db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES as any)
    .select(["metadata"])
    .where("worker_id", "=", (qb: any) =>
      qb.selectFrom(TABLE_NAMES.WORKERS as any).select("id").where("name", "=", GYM_WORKER_NAME)
    )
    .executeTakeFirst();

  let isBackfillComplete = false;
  if (scheduleRow?.metadata) {
    try {
      const parsed = JSON.parse(scheduleRow.metadata);
      if (parsed.backfill_complete) {
        isBackfillComplete = true;
      }
    } catch {}
  }

  if (isBackfillComplete) {
    gymLogger.info("Historical backfill is already marked complete.");
  } else {
    gymLogger.info("Historical backfill is in progress. Fetching older logs...");
    let backfillPages = 0;
    const MAX_BACKFILL_PAGES = 100; // fetch up to 100 pages (10000 logs) per worker run

    while (!isBackfillComplete && backfillPages < MAX_BACKFILL_PAGES) {
      const oldestLog = await db
        .selectFrom(TABLE_NAMES.GYM_TRAIN_LOGS as any)
        .select("timestamp")
        .orderBy("timestamp", "asc")
        .limit(1)
        .executeTakeFirst();

      if (!oldestLog) {
        gymLogger.info("No logs present in DB yet. Backward backfill will run after next forward sync.");
        break;
      }

      const backfillTo = Number(oldestLog.timestamp) - 1;
      if (backfillTo <= 0) {
        isBackfillComplete = true;
        gymLogger.success("Reached timestamp 0. Marking backfill as complete.");
        break;
      }

      gymLogger.info(`Fetching backward backfill page ${backfillPages + 1} (to: ${backfillTo})...`);

      try {
        const response = (await tornApi.get("/user/log" as any, {
          apiKey,
          queryParams: {
            cat: "125",
            to: String(backfillTo),
            limit: "100",
          },
        })) as any;

        const logs = response.log;
        if (!logs || !Array.isArray(logs) || logs.length === 0) {
          isBackfillComplete = true;
          gymLogger.success("No older logs returned by API. Backfill completed.");
          break;
        }

        gymLogger.debug(`Fetched backward batch of ${logs.length} older log entries.`);
        const inserted = await saveLogBatch(db, logs);
        countNewLogs += inserted;

        if (logs.length < 100) {
          isBackfillComplete = true;
          gymLogger.success("API returned last historical page. Backfill completed.");
        }

        backfillPages++;
        if (!isBackfillComplete && backfillPages < MAX_BACKFILL_PAGES) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (apiError) {
        gymLogger.error("Failed backward backfilling logs page from Torn API", apiError);
        break;
      }
    }

    if (isBackfillComplete) {
      await db
        .updateTable(TABLE_NAMES.WORKER_SCHEDULES as any)
        .set({
          metadata: JSON.stringify({ backfill_complete: true }),
          updated_at: new Date().toISOString(),
        })
        .where("worker_id", "=", (qb: any) =>
          qb.selectFrom(TABLE_NAMES.WORKERS as any).select("id").where("name", "=", GYM_WORKER_NAME)
        )
        .execute();
      gymLogger.success("Historical backfill completed and updated in scheduler metadata.");
    } else {
      gymLogger.info(`Historical backfill page limit reached for this run. Oldest log in DB is now: ${
        await db
          .selectFrom(TABLE_NAMES.GYM_TRAIN_LOGS as any)
          .select("timestamp")
          .orderBy("timestamp", "asc")
          .limit(1)
          .executeTakeFirst()
          .then((l: any) => (l ? new Date(Number(l.timestamp) * 1000).toLocaleDateString() : "unknown"))
      }`);
    }
  }

  if (countNewLogs > 0) {
    gymLogger.success(`Successfully synced ${countNewLogs} new/historical gym train log entries.`);
  } else {
    gymLogger.info("Gym train logs are up to date.");
  }
}

/**
 * Start the Torn gyms worker to synchronize training history
 */
export function startTornGymsWorker(): void {
  startDbScheduledRunner({
    worker: GYM_WORKER_NAME,
    defaultCadenceSeconds: 600, // Every 10 minutes
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: GYM_WORKER_NAME,
        timeout: 120000, // 2 minutes
        handler: syncGymTrainLogs,
      });
    },
  });
}
