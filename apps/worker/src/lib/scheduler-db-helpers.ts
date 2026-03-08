import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { randomUUID } from "crypto";

export interface WorkerRow {
  id: string;
  name: string;
}

export interface WorkerScheduleRow {
  worker_id: string;
  enabled: boolean;
  force_run: boolean;
  cadence_seconds: number;
  next_run_at: string;
  last_run_at?: string | null;
  attempts: number;
  backoff_until?: string | null;
}

export interface WorkerLogRow {
  worker_id: string;
  run_started_at?: string;
  run_finished_at?: string;
  duration_ms?: number;
  status: "success" | "error";
  message?: string | null;
  error_message?: string | null;
}

export async function ensureWorkerRegistered(
  name: string,
  cadenceSeconds: number,
  initialNextRunAt?: string,
): Promise<WorkerRow> {
  const db = getKysely();

  await db
    .insertInto(TABLE_NAMES.WORKERS)
    .values({ id: randomUUID(), name })
    .onConflict((oc) => oc.column("name").doNothing())
    .execute();

  const workerRow = await db
    .selectFrom(TABLE_NAMES.WORKERS)
    .select(["id", "name"])
    .where("name", "=", name)
    .limit(1)
    .executeTakeFirst();

  if (!workerRow) {
    throw new Error(`Failed to fetch worker id for ${name}`);
  }

  await db
    .insertInto(TABLE_NAMES.WORKER_SCHEDULES)
    .values({
      worker_id: workerRow.id,
      cadence_seconds: cadenceSeconds,
      next_run_at: initialNextRunAt || new Date().toISOString(),
    })
    .onConflict((oc) => oc.column("worker_id").doNothing())
    .execute();

  return workerRow;
}

export async function fetchDueWorker(
  workerId: string,
): Promise<WorkerScheduleRow | null> {
  const now = new Date().toISOString();
  const db = getKysely();
  const row = await db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
    .selectAll()
    .where("worker_id", "=", workerId)
    .where("enabled", "=", 1)
    .where((eb) => eb.or([eb("force_run", "=", 1), eb("next_run_at", "<=", now)]))
    .where((eb) =>
      eb.or([eb("backoff_until", "is", null), eb("backoff_until", "<=", now)]),
    )
    .limit(1)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return {
    worker_id: row.worker_id,
    enabled: Number(row.enabled) !== 0,
    force_run: Number(row.force_run) !== 0,
    cadence_seconds: row.cadence_seconds,
    next_run_at: row.next_run_at,
    last_run_at: row.last_run_at,
    attempts: row.attempts,
    backoff_until: row.backoff_until,
  };
}

export async function claimWorker(workerId: string): Promise<boolean> {
  const db = getKysely();
  const result = await db
    .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
    .set({ updated_at: new Date().toISOString() })
    .where("worker_id", "=", workerId)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

export async function completeWorker(
  workerId: string,
  cadenceSeconds: number,
): Promise<void> {
  const nextRun = new Date(Date.now() + cadenceSeconds * 1000).toISOString();
  const db = getKysely();
  const now = new Date().toISOString();
  await db
    .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
    .set({
      last_run_at: now,
      next_run_at: nextRun,
      force_run: 0,
      attempts: 0,
      backoff_until: null,
      updated_at: now,
    })
    .where("worker_id", "=", workerId)
    .execute();
}

export async function failWorker(
  workerId: string,
  attempts: number,
  _errorMessage: string,
): Promise<void> {
  const nextAttempts = attempts + 1;
  const backoffSeconds = Math.min(Math.pow(2, nextAttempts) * 60, 3600);
  const backoffUntil = new Date(
    Date.now() + backoffSeconds * 1000,
  ).toISOString();
  const db = getKysely();
  await db
    .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
    .set({
      force_run: 0,
      attempts: nextAttempts,
      backoff_until: backoffUntil,
      updated_at: new Date().toISOString(),
    })
    .where("worker_id", "=", workerId)
    .execute();
}

export async function triggerWorkerNow(workerId: string): Promise<void> {
  const db = getKysely();
  await db
    .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
    .set({ force_run: 1 })
    .where("worker_id", "=", workerId)
    .execute();
}

export async function updateWorkerCadence(
  workerId: string,
  cadenceSeconds: number,
): Promise<void> {
  const db = getKysely();
  await db
    .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
    .set({ cadence_seconds: cadenceSeconds })
    .where("worker_id", "=", workerId)
    .execute();
}

export async function insertWorkerLog(row: WorkerLogRow): Promise<void> {
  const db = getKysely();
  await db
    .insertInto(TABLE_NAMES.WORKER_LOGS)
    .values({
      worker_id: row.worker_id,
      run_started_at: row.run_started_at ?? new Date().toISOString(),
      run_finished_at: row.run_finished_at ?? null,
      duration_ms: row.duration_ms ?? null,
      status: row.status,
      message: row.message ?? null,
      error_message: row.error_message ?? null,
    })
    .execute();
}
