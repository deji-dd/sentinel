import { randomUUID } from "crypto";
import { TABLE_NAMES } from "./constants.js";
import { getKysely } from "./db/sqlite.js";

export interface WorkerRow {
  id: string;
  name: string;
}

export interface WorkerScheduleRow {
  worker_id: string;
  worker_name: string;
  enabled: boolean;
  force_run: boolean;
  cadence_seconds: number;
  next_run_at: string;
  last_run_at?: string | null;
  attempts: number;
  backoff_until?: string | null;
  metadata?: string | null;
}

export interface WorkerRegistrationOptions {
  name: string;
  cadenceSeconds: number;
  initialNextRunAt?: string;
  enabled?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface DueWorkerSchedule extends WorkerScheduleRow {
  worker_id: string;
  worker_name: string;
}

function serializeMetadata(
  metadata?: Record<string, unknown> | null,
): string | null {
  if (!metadata) {
    return null;
  }

  return JSON.stringify(metadata);
}

async function ensureWorkerRow(name: string): Promise<WorkerRow> {
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

  return workerRow;
}

export function buildWorkerName(baseName: string, scopeKey?: string): string {
  return scopeKey ? `${baseName}:${scopeKey}` : baseName;
}

export async function ensureWorkerRegistered(
  options: WorkerRegistrationOptions,
): Promise<WorkerRow> {
  const db = getKysely();
  const workerRow = await ensureWorkerRow(options.name);
  const now = new Date().toISOString();
  const metadata = serializeMetadata(options.metadata ?? null);
  const enabled = options.enabled === false ? 0 : 1;

  const scheduleRow = await db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
    .select(["worker_id"])
    .where("worker_id", "=", workerRow.id)
    .limit(1)
    .executeTakeFirst();

  if (scheduleRow) {
    const updateValues: Record<string, unknown> = {
      cadence_seconds: options.cadenceSeconds,
      enabled,
      metadata,
      updated_at: now,
    };

    if (options.initialNextRunAt) {
      updateValues.next_run_at = options.initialNextRunAt;
    }

    await db
      .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
      .set(updateValues)
      .where("worker_id", "=", workerRow.id)
      .execute();
    return workerRow;
  }

  await db
    .insertInto(TABLE_NAMES.WORKER_SCHEDULES)
    .values({
      worker_id: workerRow.id,
      cadence_seconds: options.cadenceSeconds,
      enabled,
      force_run: 0,
      next_run_at: options.initialNextRunAt || now,
      metadata,
    })
    .execute();

  return workerRow;
}

export async function setWorkerScheduleEnabled(
  name: string,
  enabled: boolean,
): Promise<void> {
  const db = getKysely();
  const worker = await db
    .selectFrom(TABLE_NAMES.WORKERS)
    .select(["id"])
    .where("name", "=", name)
    .limit(1)
    .executeTakeFirst();

  if (!worker) {
    return;
  }

  await db
    .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
    .set({ enabled: enabled ? 1 : 0, updated_at: new Date().toISOString() })
    .where("worker_id", "=", worker.id)
    .execute();
}

export async function fetchDueWorkerSchedules(options: {
  workerNamePrefix?: string;
  workerName?: string;
  limit?: number;
}): Promise<DueWorkerSchedule[]> {
  const db = getKysely();
  const now = new Date().toISOString();
  let query = db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
    .innerJoin(
      TABLE_NAMES.WORKERS,
      `${TABLE_NAMES.WORKER_SCHEDULES}.worker_id`,
      `${TABLE_NAMES.WORKERS}.id`,
    )
    .select([
      `${TABLE_NAMES.WORKER_SCHEDULES}.worker_id as worker_id`,
      `${TABLE_NAMES.WORKERS}.name as worker_name`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.enabled as enabled`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.force_run as force_run`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.cadence_seconds as cadence_seconds`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.next_run_at as next_run_at`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.last_run_at as last_run_at`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.attempts as attempts`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.backoff_until as backoff_until`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.metadata as metadata`,
    ])
    .where(`${TABLE_NAMES.WORKER_SCHEDULES}.enabled`, "=", 1)
    .where((eb) =>
      eb.or([
        eb(`${TABLE_NAMES.WORKER_SCHEDULES}.force_run`, "=", 1),
        eb(`${TABLE_NAMES.WORKER_SCHEDULES}.next_run_at`, "<=", now),
      ]),
    )
    .where((eb) =>
      eb.or([
        eb(`${TABLE_NAMES.WORKER_SCHEDULES}.backoff_until`, "is", null),
        eb(`${TABLE_NAMES.WORKER_SCHEDULES}.backoff_until`, "<=", now),
      ]),
    )
    .orderBy(`${TABLE_NAMES.WORKER_SCHEDULES}.next_run_at`, "asc");

  if (options.workerName) {
    query = query.where(`${TABLE_NAMES.WORKERS}.name`, "=", options.workerName);
  }

  if (options.workerNamePrefix) {
    query = query.where(
      `${TABLE_NAMES.WORKERS}.name`,
      "like",
      `${options.workerNamePrefix}%`,
    );
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const rows = await query.execute();

  return rows.map((row) => ({
    worker_id: row.worker_id,
    worker_name: row.worker_name,
    enabled: Number(row.enabled) !== 0,
    force_run: Number(row.force_run) !== 0,
    cadence_seconds: row.cadence_seconds,
    next_run_at: row.next_run_at,
    last_run_at: row.last_run_at,
    attempts: row.attempts,
    backoff_until: row.backoff_until,
    metadata: row.metadata,
  }));
}

export async function claimWorker(workerId: string): Promise<boolean> {
  const db = getKysely();
  const now = new Date().toISOString();

  const result = await db
    .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
    .set({
      updated_at: now,
      next_run_at: new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    })
    .where("worker_id", "=", workerId)
    .where((eb) =>
      eb.or([eb("force_run", "=", 1), eb("next_run_at", "<=", now)]),
    )
    .executeTakeFirst();

  return Number(result.numUpdatedRows) > 0;
}

export async function completeWorker(
  workerId: string,
  cadenceSeconds: number,
): Promise<void> {
  const db = getKysely();
  const now = new Date().toISOString();
  const nextRun = new Date(Date.now() + cadenceSeconds * 1000).toISOString();

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
  const cappedAttempts = nextAttempts > 10 ? 5 : nextAttempts;
  const backoffSeconds = Math.min(Math.pow(2, cappedAttempts) * 60, 3600);
  const db = getKysely();

  await db
    .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
    .set({
      force_run: 0,
      attempts: cappedAttempts,
      backoff_until: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
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

export async function insertWorkerLog(row: {
  worker_id: string;
  run_started_at?: string;
  run_finished_at?: string;
  duration_ms?: number;
  status: "success" | "error";
  message?: string | null;
  error_message?: string | null;
}): Promise<void> {
  const db = getKysely();
  await db
    .insertInto(TABLE_NAMES.WORKER_LOGS)
    .values({
      id: randomUUID(),
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

export async function resetStuckWorkerSchedules(): Promise<number> {
  const db = getKysely();
  const now = new Date();
  const lockThreshold = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 1 day in the future
  const resetTime = now.toISOString();

  const result = await db
    .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
    .set({
      next_run_at: resetTime,
      force_run: 0,
      attempts: 0,
      backoff_until: null,
      updated_at: resetTime,
    })
    .where("next_run_at", ">", lockThreshold)
    .executeTakeFirst();

  return Number(result.numUpdatedRows) || 0;
}
