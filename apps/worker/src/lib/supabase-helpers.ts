import { supabase } from "./supabase.js";
import { TABLE_NAMES } from "./constants.js";

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
  let workerRow: WorkerRow | null = null;

  const { data: inserted, error: insertError } = await supabase
    .from(TABLE_NAMES.WORKERS)
    .insert({ name })
    .select("id, name")
    .single();

  if (insertError && insertError.code !== "23505") {
    throw new Error(`Failed to register worker: ${insertError.message}`);
  }

  if (inserted) {
    workerRow = inserted as WorkerRow;
  }

  if (!workerRow) {
    const { data: existing, error: fetchError } = await supabase
      .from(TABLE_NAMES.WORKERS)
      .select("id, name")
      .eq("name", name)
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch worker id: ${fetchError.message}`);
    }

    workerRow = existing as WorkerRow;
  }

  // Ensure schedule row exists for the worker
  const { error: schedError } = await supabase
    .from(TABLE_NAMES.WORKER_SCHEDULES)
    .upsert(
      {
        worker_id: workerRow.id,
        cadence_seconds: cadenceSeconds,
        next_run_at: initialNextRunAt || new Date().toISOString(),
      },
      { onConflict: "worker_id" },
    );

  if (schedError) {
    throw new Error(`Failed to ensure schedule: ${schedError.message}`);
  }

  return workerRow;
}

export async function fetchDueWorker(
  workerId: string,
): Promise<WorkerScheduleRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(TABLE_NAMES.WORKER_SCHEDULES)
    .select("*")
    .eq("worker_id", workerId)
    .eq("enabled", true)
    .or(`force_run.eq.true,next_run_at.lte.${now}`)
    .or(`backoff_until.is.null,backoff_until.lte.${now}`)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch schedule: ${error.message}`);
  }

  return (data as WorkerScheduleRow) || null;
}

export async function claimWorker(workerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.WORKER_SCHEDULES)
    .update({ updated_at: new Date().toISOString() })
    .eq("worker_id", workerId)
    .select("worker_id");

  if (error) {
    throw new Error(`Failed to claim worker: ${error.message}`);
  }
  return (data?.length || 0) > 0;
}

export async function completeWorker(
  workerId: string,
  cadenceSeconds: number,
): Promise<void> {
  const nextRun = new Date(Date.now() + cadenceSeconds * 1000).toISOString();
  const { error } = await supabase
    .from(TABLE_NAMES.WORKER_SCHEDULES)
    .update({
      last_run_at: new Date().toISOString(),
      next_run_at: nextRun,
      force_run: false,
      attempts: 0,
      backoff_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("worker_id", workerId);

  if (error) {
    throw new Error(`Failed to complete worker: ${error.message}`);
  }
}

export async function failWorker(
  workerId: string,
  attempts: number,
  errorMessage: string,
): Promise<void> {
  const nextAttempts = attempts + 1;
  const backoffSeconds = Math.min(Math.pow(2, nextAttempts) * 60, 3600);
  const backoffUntil = new Date(
    Date.now() + backoffSeconds * 1000,
  ).toISOString();
  const { error } = await supabase
    .from(TABLE_NAMES.WORKER_SCHEDULES)
    .update({
      force_run: false,
      attempts: nextAttempts,
      backoff_until: backoffUntil,
      updated_at: new Date().toISOString(),
    })
    .eq("worker_id", workerId);

  if (error) {
    throw new Error(`Failed to fail worker: ${error.message}`);
  }
}

export async function triggerWorkerNow(workerId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE_NAMES.WORKER_SCHEDULES)
    .update({ force_run: true })
    .eq("worker_id", workerId);

  if (error) {
    throw new Error(`Failed to trigger worker: ${error.message}`);
  }
}

export async function insertWorkerLog(row: WorkerLogRow): Promise<void> {
  const { error } = await supabase.from(TABLE_NAMES.WORKER_LOGS).insert(row);
  if (error) {
    throw new Error(`Failed to insert worker log: ${error.message}`);
  }
}
