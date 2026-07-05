/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeSync } from "../lib/sync.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { Logger } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { TABLE_NAMES } from "@sentinel/shared";

const WORKER_NAME = "central_log_manager";
const logger = new Logger(WORKER_NAME);

// Configurable backfill rate settings
const BACKFILL_CONFIG = {
  maxPagesPerRun: 50, // Increased from 20 to 50 pages per execution (up to 5000 logs)
  pageSize: 100, // Number of logs per page
  delayBetweenRequestsMs: 500, // Reduced from 500ms to 250ms for faster processing
};

async function saveLogsToCentral(db: any, logs: any[]): Promise<number> {
  let inserted = 0;
  for (const log of logs) {
    const rawId = String(log.id);
    const timestamp = Number(log.timestamp);
    const category = String(log.details?.category || log.category || "");
    const title = String(log.details?.title || log.title || "");
    const data = log.data || {};

    const result = await db
      .insertInto(TABLE_NAMES.USER_LOGS as any)
      .values({
        log_id: rawId,
        timestamp,
        category,
        title,
        data: JSON.stringify(data),
      })
      .onConflict((oc: any) => oc.column("log_id").doNothing())
      .executeTakeFirst();

    if (Number(result.numInsertedOrUpdatedRows || 0) > 0) {
      inserted++;
    }
  }
  return inserted;
}

export async function syncLogs(): Promise<void> {
  const apiKey = await getSystemApiKey("personal");
  const db = getKysely();

  // Load scheduler metadata to fetch backfill progress
  const schedule = await db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES as any)
    .select(["metadata"])
    .where("worker_id", "=", (qb: any) =>
      qb
        .selectFrom(TABLE_NAMES.WORKERS as any)
        .select("id")
        .where("name", "=", WORKER_NAME),
    )
    .executeTakeFirst();

  let backfillComplete = false;
  let totalPagesCrawled = 0;
  let oldestTimestamp = Math.floor(Date.now() / 1000);

  if (schedule?.metadata) {
    try {
      const parsed = JSON.parse(schedule.metadata);
      backfillComplete = !!parsed.backfill_complete;
      totalPagesCrawled = Number(parsed.total_pages_crawled || 0);
      oldestTimestamp = Number(parsed.oldest_timestamp || oldestTimestamp);
    } catch {}
  } else {
    // Self-healing check: get the oldest log currently stored in our DB
    const oldestDbLog = await db
      .selectFrom(TABLE_NAMES.USER_LOGS as any)
      .select("timestamp")
      .orderBy("timestamp", "asc")
      .limit(1)
      .executeTakeFirst();

    if (oldestDbLog) {
      oldestTimestamp = Number(oldestDbLog.timestamp);
      logger.info(`No metadata found, but found existing logs in DB. Resuming backfill from oldest log: ${oldestTimestamp}`);
    }
  }

  const isDev = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "dev" || process.env.SKIP_BACKFILL === "true";
  if (isDev && !backfillComplete) {
    logger.info("Running in development mode. Skipping backward logs backfill and marking complete.");
    backfillComplete = true;
  }

  // 1. Backward Crawl (Historical sync)
  if (!backfillComplete) {
    logger.info(
      `Starting backward logs backfill from timestamp ${oldestTimestamp}...`,
    );
    let backfillPages = 0;

    while (
      !backfillComplete &&
      backfillPages < BACKFILL_CONFIG.maxPagesPerRun
    ) {
      logger.info(
        `Fetching backward logs page ${backfillPages + 1} (to: ${oldestTimestamp})...`,
      );
      try {
        const response = (await tornApi.get("/user/log" as any, {
          apiKey,
          queryParams: {
            to: String(oldestTimestamp - 1),
            limit: String(BACKFILL_CONFIG.pageSize),
          },
        })) as any;

        let logs = response.log;
        if (logs && typeof logs === "object" && !Array.isArray(logs)) {
          logs = Object.entries(logs).map(([id, val]: [string, any]) => ({
            id,
            ...val,
          }));
        }

        if (!logs || !Array.isArray(logs) || logs.length === 0) {
          backfillComplete = true;
          logger.success("No more historical logs. Backfill complete!");
          break;
        }

        // Sort descending (newest first) so that logs[logs.length-1] is the oldest log in this batch
        logs.sort(
          (a: any, b: any) => Number(b.timestamp) - Number(a.timestamp),
        );

        const inserted = await saveLogsToCentral(db, logs);

        const oldestInBatch = logs[logs.length - 1];
        oldestTimestamp = Number(oldestInBatch.timestamp);
        totalPagesCrawled++;
        backfillPages++;

        logger.info(
          `Saved ${inserted} logs. Oldest timestamp is now: ${oldestTimestamp}`,
        );

        // Rate limiter breathing room
        await new Promise((resolve) =>
          setTimeout(resolve, BACKFILL_CONFIG.delayBetweenRequestsMs),
        );
      } catch (err) {
        logger.error("Failed during backward logs backfill page", err);
        break;
      }
    }
  }

  // Save crawl state (always persist, ensuring dev skips are written to DB)
  await db
    .updateTable(TABLE_NAMES.WORKER_SCHEDULES as any)
    .set({
      metadata: JSON.stringify({
        backfill_complete: backfillComplete,
        oldest_timestamp: oldestTimestamp,
        total_pages_crawled: totalPagesCrawled,
      }),
      updated_at: new Date().toISOString(),
    })
    .where("worker_id", "=", (qb: any) =>
      qb
        .selectFrom(TABLE_NAMES.WORKERS as any)
        .select("id")
        .where("name", "=", WORKER_NAME),
    )
    .execute();

  // 2. Forward Sync (Get latest logs)
  const latestLog = await db
    .selectFrom(TABLE_NAMES.USER_LOGS as any)
    .select("timestamp")
    .orderBy("timestamp", "desc")
    .limit(1)
    .executeTakeFirst();

  if (latestLog) {
    const fromTimestamp = Number(latestLog.timestamp) - 3600;
    const now = Math.floor(Date.now() / 1000);
    logger.info(
      `Starting forward logs sync from timestamp ${fromTimestamp} to ${now}...`,
    );

    let currentTo = now;
    let forwardPages = 0;
    const MAX_FORWARD_PAGES = 10;
    let hasMore = true;

    while (hasMore && forwardPages < MAX_FORWARD_PAGES) {
      try {
        const response = (await tornApi.get("/user/log" as any, {
          apiKey,
          queryParams: {
            from: String(fromTimestamp),
            to: String(currentTo),
            limit: "100",
          },
        })) as any;

        let logs = response.log;
        if (logs && typeof logs === "object" && !Array.isArray(logs)) {
          logs = Object.entries(logs).map(([id, val]: [string, any]) => ({
            id,
            ...val,
          }));
        }

        if (!logs || !Array.isArray(logs) || logs.length === 0) {
          break;
        }

        // Sort descending (newest first) so that logs[logs.length-1] is the oldest log in this batch
        logs.sort(
          (a: any, b: any) => Number(b.timestamp) - Number(a.timestamp),
        );

        await saveLogsToCentral(db, logs);

        if (logs.length < 100) {
          hasMore = false;
        } else {
          const oldestInBatch = logs[logs.length - 1];
          currentTo = Number(oldestInBatch.timestamp) - 1;
          if (currentTo < fromTimestamp) {
            hasMore = false;
          }
        }

        forwardPages++;
        if (hasMore && forwardPages < MAX_FORWARD_PAGES) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (err) {
        logger.error("Failed forward syncing logs page", err);
        break;
      }
    }
  } else {
    logger.warn(
      "No logs in database yet. Skipping forward sync until backward sync saves initial logs.",
    );
  }
}

export function startCentralLogManager(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 60, // Sync logs every 2 minutes
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 180000, // 3 minutes
        handler: syncLogs,
      });
    },
  });
}
