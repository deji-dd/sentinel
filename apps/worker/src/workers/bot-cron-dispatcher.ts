import {
  claimWorker,
  completeWorker,
  failWorker,
  fetchDueWorkerSchedules,
  insertWorkerLog,
} from "@sentinel/shared";
import { Logger } from "../lib/logger.js";

const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL || "http://localhost:3001";
const isDev =
  (process.env.NODE_ENV || "").trim().toLowerCase() === "development" ||
  (process.env.NODE_ENV || "").trim().toLowerCase() === "dev";
const WORKER_BRIDGE_SECRET =
  process.env.WORKER_BRIDGE_SECRET ||
  process.env.BOT_WORKER_BRIDGE_SECRET ||
  (isDev ? "dev-secret-bridge-token" : "");
const POLL_INTERVAL_MS = 5000;
const logger = new Logger("bot_cron_dispatch");

let inFlight = false;
let started = false;

function parseMetadata(
  metadata: string | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadata);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

async function dispatchJob(schedule: {
  worker_id: string;
  worker_name: string;
  cadence_seconds: number;
  attempts: number;
  metadata?: string | null;
}): Promise<void> {
  const response = await fetch(
    `${BOT_WEBHOOK_URL}/internal/worker-jobs/execute`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${WORKER_BRIDGE_SECRET}`,
      },
      body: JSON.stringify({
        workerName: schedule.worker_name,
        metadata: parseMetadata(schedule.metadata),
      }),
    },
  );

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `Bot job execution failed for ${schedule.worker_name}: ${response.status} ${response.statusText}${responseText ? ` - ${responseText}` : ""}`,
    );
  }

  await completeWorker(schedule.worker_id, schedule.cadence_seconds);
  await insertWorkerLog({
    worker_id: schedule.worker_id,
    status: "success",
    run_started_at: new Date().toISOString(),
    run_finished_at: new Date().toISOString(),
  });

  logger.success(`Successfully executed job ${schedule.worker_name}`);

  if (schedule.attempts > 0) {
    logger.warn(
      `Recovered ${schedule.worker_name} after ${schedule.attempts} attempt(s)`,
    );
  }
}

async function pollAndDispatch(): Promise<void> {
  if (inFlight) {
    return;
  }

  inFlight = true;
  try {
    if (!WORKER_BRIDGE_SECRET) {
      logger.error("WORKER_BRIDGE_SECRET is missing");
      return;
    }

    const dueSchedules = await fetchDueWorkerSchedules({
      workerNamePrefix: "bot:",
      limit: 100,
    });

    for (const schedule of dueSchedules) {
      const claimed = await claimWorker(schedule.worker_id);
      if (!claimed) {
        continue;
      }

      const startedAt = new Date().toISOString();
      try {
        await dispatchJob(schedule);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failWorker(schedule.worker_id, schedule.attempts, message);
        await insertWorkerLog({
          worker_id: schedule.worker_id,
          status: "error",
          error_message: message,
          run_started_at: startedAt,
          run_finished_at: new Date().toISOString(),
        });
        logger.error(`Failed to dispatch job ${schedule.worker_name}`, error);
      }
    }
  } finally {
    inFlight = false;
  }
}

export function startBotCronDispatcherWorker(): void {
  if (started) {
    return;
  }

  started = true;
  void pollAndDispatch();
  setInterval(() => {
    void pollAndDispatch();
  }, POLL_INTERVAL_MS);
}
