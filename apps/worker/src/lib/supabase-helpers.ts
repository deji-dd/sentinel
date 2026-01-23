import { supabase } from "./supabase.js";
import { TABLE_NAMES } from "./constants.js";
import os from "os";

const PROCESS_ID = `${os.hostname()}-${process.pid}`;

export interface WorkerScheduleRow {
  worker: string;
  enabled: boolean;
  force_run: boolean;
  cadence_seconds: number;
  next_run_at: string;
  last_run_at?: string | null;
  status?: string | null;
  error_message?: string | null;
  attempts: number;
  backoff_until?: string | null;
  locked_by?: string | null;
  locked_at?: string | null;
}

export async function fetchDueWorker(
  worker: string,
): Promise<WorkerScheduleRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(TABLE_NAMES.WORKER_SCHEDULES)
    .select("*")
    .eq("worker", worker)
    .eq("enabled", true)
    .or(`force_run.eq.true,next_run_at.lte.${now}`)
    .or(`backoff_until.is.null,backoff_until.lte.${now}`)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows
    throw new Error(`Failed to fetch schedule: ${error.message}`);
  }

  return data || null;
}

export async function claimWorker(worker: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.WORKER_SCHEDULES)
    .update({
      status: "running",
      locked_at: new Date().toISOString(),
    })
    .eq("worker", worker)
    .select("worker");

  if (error) {
    throw new Error(`Failed to claim worker: ${error.message}`);
  }
  return (data?.length || 0) > 0;
}

export async function completeWorker(
  worker: string,
  cadenceSeconds: number,
): Promise<void> {
  const nextRun = new Date(Date.now() + cadenceSeconds * 1000).toISOString();
  const { error } = await supabase
    .from(TABLE_NAMES.WORKER_SCHEDULES)
    .update({
      last_run_at: new Date().toISOString(),
      next_run_at: nextRun,
      force_run: false,
      status: null,
      error_message: null,
      attempts: 0,
      backoff_until: null,
      locked_at: null,
    })
    .eq("worker", worker);

  if (error) {
    throw new Error(`Failed to complete worker: ${error.message}`);
  }
}

export async function failWorker(
  worker: string,
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
      status: "error",
      error_message: errorMessage,
      attempts: nextAttempts,
      backoff_until: backoffUntil,
      locked_at: null,
    })
    .eq("worker", worker);

  if (error) {
    throw new Error(`Failed to fail worker: ${error.message}`);
  }
}

export async function triggerWorkerNow(worker: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE_NAMES.WORKER_SCHEDULES)
    .update({ force_run: true })
    .eq("worker", worker);

  if (error) {
    throw new Error(`Failed to trigger worker: ${error.message}`);
  }
}
