import { TABLE_NAMES } from "@sentinel/shared";
import { getDB } from "@sentinel/shared/db/sqlite.js";

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

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
  const db = getDB();
  const workersTable = quoteIdentifier(TABLE_NAMES.WORKERS);
  const schedulesTable = quoteIdentifier(TABLE_NAMES.WORKER_SCHEDULES);

  db.prepare(`INSERT OR IGNORE INTO ${workersTable} (name) VALUES (?)`).run(
    name,
  );

  const workerRow = db
    .prepare(`SELECT id, name FROM ${workersTable} WHERE name = ? LIMIT 1`)
    .get(name) as WorkerRow | undefined;

  if (!workerRow) {
    throw new Error(`Failed to fetch worker id for ${name}`);
  }

  db.prepare(
    `INSERT OR IGNORE INTO ${schedulesTable} (worker_id, cadence_seconds, next_run_at)
     VALUES (?, ?, ?)`,
  ).run(
    workerRow.id,
    cadenceSeconds,
    initialNextRunAt || new Date().toISOString(),
  );

  return workerRow;
}

export async function fetchDueWorker(
  workerId: string,
): Promise<WorkerScheduleRow | null> {
  const now = new Date().toISOString();
  const db = getDB();
  const row = db
    .prepare(
      `SELECT * FROM ${quoteIdentifier(TABLE_NAMES.WORKER_SCHEDULES)}
       WHERE worker_id = ?
         AND enabled = 1
         AND (force_run = 1 OR next_run_at <= ?)
         AND (backoff_until IS NULL OR backoff_until <= ?)
       LIMIT 1`,
    )
    .get(workerId, now, now) as WorkerScheduleRow | undefined;

  return row || null;
}

export async function claimWorker(workerId: string): Promise<boolean> {
  const db = getDB();
  const result = db
    .prepare(
      `UPDATE ${quoteIdentifier(TABLE_NAMES.WORKER_SCHEDULES)} SET updated_at = ? WHERE worker_id = ?`,
    )
    .run(new Date().toISOString(), workerId);
  return result.changes > 0;
}

export async function completeWorker(
  workerId: string,
  cadenceSeconds: number,
): Promise<void> {
  const nextRun = new Date(Date.now() + cadenceSeconds * 1000).toISOString();
  const db = getDB();
  db.prepare(
    `UPDATE ${quoteIdentifier(TABLE_NAMES.WORKER_SCHEDULES)}
     SET last_run_at = ?, next_run_at = ?, force_run = 0, attempts = 0, backoff_until = NULL, updated_at = ?
     WHERE worker_id = ?`,
  ).run(new Date().toISOString(), nextRun, new Date().toISOString(), workerId);
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
  const db = getDB();
  db.prepare(
    `UPDATE ${quoteIdentifier(TABLE_NAMES.WORKER_SCHEDULES)}
     SET force_run = 0, attempts = ?, backoff_until = ?, updated_at = ?
     WHERE worker_id = ?`,
  ).run(nextAttempts, backoffUntil, new Date().toISOString(), workerId);
}

export async function triggerWorkerNow(workerId: string): Promise<void> {
  const db = getDB();
  db.prepare(
    `UPDATE ${quoteIdentifier(TABLE_NAMES.WORKER_SCHEDULES)} SET force_run = 1 WHERE worker_id = ?`,
  ).run(workerId);
}

export async function updateWorkerCadence(
  workerId: string,
  cadenceSeconds: number,
): Promise<void> {
  const db = getDB();
  db.prepare(
    `UPDATE ${quoteIdentifier(TABLE_NAMES.WORKER_SCHEDULES)} SET cadence_seconds = ? WHERE worker_id = ?`,
  ).run(cadenceSeconds, workerId);
}

export async function insertWorkerLog(row: WorkerLogRow): Promise<void> {
  const db = getDB();
  db.prepare(
    `INSERT INTO ${quoteIdentifier(TABLE_NAMES.WORKER_LOGS)}
      (worker_id, run_started_at, run_finished_at, duration_ms, status, message, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.worker_id,
    row.run_started_at ?? null,
    row.run_finished_at ?? null,
    row.duration_ms ?? null,
    row.status,
    row.message ?? null,
    row.error_message ?? null,
  );
}
