import { createClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "./constants.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required",
  );
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export interface User {
  user_id: string;
  player_id: number;
  name: string;
  api_key: string; // encrypted
  created_at: string;
  updated_at: string;
}

export interface TravelData {
  user_id: string;
  travel_destination: string | null;
  travel_method: string | null;
  travel_departed_at: string | null;
  travel_arrival_at: string | null;
  travel_time_left: number | null;
  updated_at?: string;
}

export interface WorkerSchedule {
  user_id: string;
  worker: string;
  next_run_at: string;
}

export interface StockCacheRow {
  destination: string;
  item_name: string;
  item_id: number;
  quantity: number;
  cost: number;
  last_updated: string;
}

export async function getAllUsers(): Promise<User[]> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.USERS)
    .select("*")
    .returns<User[]>();

  if (error) {
    throw new Error(`Failed to fetch users: ${error.message}`);
  }

  return data || [];
}

export async function updateUserProfile(
  updates: Array<{ user_id: string; name: string; player_id: number }>,
): Promise<void> {
  if (updates.length === 0) return;

  // Update only name and player_id, leaving api_key untouched
  for (const update of updates) {
    const { error } = await supabase
      .from(TABLE_NAMES.USERS)
      .update({ name: update.name, player_id: update.player_id })
      .eq("user_id", update.user_id);

    if (error) {
      throw new Error(
        `Failed to update user ${update.user_id}: ${error.message}`,
      );
    }
  }
}

export async function upsertTravelData(updates: TravelData[]): Promise<void> {
  if (updates.length === 0) return;

  const { error } = await supabase
    .from(TABLE_NAMES.TRAVEL_DATA)
    .upsert(updates, {
      onConflict: "user_id",
    });

  if (error) {
    throw new Error(`Failed to upsert travel data: ${error.message}`);
  }
}

export async function getWorkerSchedules(
  worker: string,
): Promise<Map<string, WorkerSchedule>> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.USER_WORKER_SCHEDULES)
    .select("user_id, worker, next_run_at")
    .eq("worker", worker)
    .returns<WorkerSchedule[]>();

  if (error) {
    throw new Error(`Failed to fetch worker schedules: ${error.message}`);
  }

  const scheduleMap = new Map<string, WorkerSchedule>();
  for (const row of data || []) {
    scheduleMap.set(row.user_id, row);
  }

  return scheduleMap;
}

export async function upsertWorkerSchedules(
  schedules: WorkerSchedule[],
): Promise<void> {
  if (schedules.length === 0) return;

  const { error } = await supabase
    .from(TABLE_NAMES.USER_WORKER_SCHEDULES)
    .upsert(schedules, {
      onConflict: "user_id,worker",
    });

  if (error) {
    throw new Error(`Failed to upsert worker schedules: ${error.message}`);
  }
}

export async function insertStockCache(rows: StockCacheRow[]): Promise<void> {
  if (rows.length === 0) return;

  const { error } = await supabase
    .from("sentinel_travel_stock_cache")
    .insert(rows);

  if (error) {
    throw new Error(`Failed to insert stock cache: ${error.message}`);
  }
}
