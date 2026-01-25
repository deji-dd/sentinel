/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "./encryption.js";
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
  capacity?: number;
  has_airstrip?: boolean;
  has_wlt_benefit?: boolean;
  active_travel_book?: boolean;
  updated_at?: string;
}

export interface UserProfileData {
  user_id: string;
  player_id: number;
  name: string;
  is_donator: boolean;
  profile_image: string | null;
  discord_id?: string | null;
  updated_at?: string;
}

export interface UserBarsData {
  user_id: string;
  energy_current: number;
  energy_maximum: number;
  nerve_current: number;
  nerve_maximum: number;
  happy_current: number;
  happy_maximum: number;
  life_current: number;
  life_maximum: number;
  energy_flat_time_to_full?: number;
  energy_time_to_full?: number;
  nerve_flat_time_to_full?: number;
  nerve_time_to_full?: number;
  updated_at?: string;
}

export interface UserCooldownsData {
  user_id: string;
  drug: number;
  medical: number;
  booster: number;
  updated_at?: string;
}

export interface StockCacheRow {
  destination_id: number;
  item_id: number;
  quantity: number;
  cost: number;
  last_updated: string;
}

export interface TornItemRow {
  item_id: number;
  name: string;
  image: string | null;
  type: string | null;
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

export async function getTravelDataByUserIds(
  userIds: string[],
): Promise<Map<string, TravelData>> {
  const map = new Map<string, TravelData>();
  if (!userIds.length) return map;

  const { data, error } = await supabase
    .from(TABLE_NAMES.TRAVEL_DATA)
    .select("*")
    .in("user_id", userIds);

  if (error) {
    throw new Error(`Failed to fetch travel data: ${error.message}`);
  }

  (data || []).forEach((row) => {
    map.set((row as any).user_id as string, row as TravelData);
  });

  return map;
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

export async function upsertUserData(
  updates: UserProfileData[],
): Promise<void> {
  if (updates.length === 0) return;

  const { error } = await supabase.from(TABLE_NAMES.USER_DATA).upsert(updates, {
    onConflict: "user_id",
  });

  if (error) {
    throw new Error(`Failed to upsert user data: ${error.message}`);
  }
}

export async function upsertUserBars(updates: UserBarsData[]): Promise<void> {
  if (updates.length === 0) return;

  const { error } = await supabase.from(TABLE_NAMES.USER_BARS).upsert(updates, {
    onConflict: "user_id",
  });

  if (error) {
    throw new Error(`Failed to upsert user bars: ${error.message}`);
  }
}

export async function getUserBarsByUserIds(
  userIds: string[],
): Promise<Map<string, UserBarsData>> {
  const map = new Map<string, UserBarsData>();
  if (!userIds.length) return map;

  const { data, error } = await supabase
    .from(TABLE_NAMES.USER_BARS)
    .select("*")
    .in("user_id", userIds);

  if (error) {
    throw new Error(`Failed to fetch user bars: ${error.message}`);
  }

  (data || []).forEach((row) => {
    map.set((row as any).user_id as string, row as UserBarsData);
  });

  return map;
}

export async function upsertUserCooldowns(
  updates: UserCooldownsData[],
): Promise<void> {
  if (updates.length === 0) return;

  const { error } = await supabase
    .from(TABLE_NAMES.USER_COOLDOWNS)
    .upsert(updates, {
      onConflict: "user_id",
    });

  if (error) {
    throw new Error(`Failed to upsert user cooldowns: ${error.message}`);
  }
}

export async function getUserCooldownsByUserIds(
  userIds: string[],
): Promise<Map<string, UserCooldownsData>> {
  const map = new Map<string, UserCooldownsData>();
  if (!userIds.length) return map;

  const { data, error } = await supabase
    .from(TABLE_NAMES.USER_COOLDOWNS)
    .select("*")
    .in("user_id", userIds);

  if (error) {
    throw new Error(`Failed to fetch user cooldowns: ${error.message}`);
  }

  (data || []).forEach((row) => {
    map.set((row as any).user_id as string, row as UserCooldownsData);
  });

  return map;
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

export async function getTravelStockCache(): Promise<StockCacheRow[]> {
  // With Supabase row limit increased to 1M, we can fetch all stock cache in a single query.
  // Order by last_updated DESC to get most recent snapshots first.
  // App layer will group by (destination_id, item_id) to get latest per item.
  const { data, error } = await supabase
    .from("sentinel_travel_stock_cache")
    .select("*")
    .order("last_updated", { ascending: false })
    .order("ingested_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch travel stock cache: ${error.message}`);
  }

  const result = (data || []) as StockCacheRow[];
  return result;
}

export interface TornDestinationRow {
  id: number;
  name: string;
  country_code: string;
}

export async function getDestinations(): Promise<TornDestinationRow[]> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.TORN_DESTINATIONS)
    .select("id, name, country_code");

  if (error) {
    throw new Error(`Failed to fetch destinations: ${error.message}`);
  }

  return (data || []) as TornDestinationRow[];
}

export async function cleanupOldStockCache(
  retentionDays: number = 7,
): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const { error } = await supabase
    .from("sentinel_travel_stock_cache")
    .delete()
    .lt("ingested_at", cutoffDate.toISOString());

  if (error) {
    throw new Error(`Failed to cleanup stock cache: ${error.message}`);
  }
}

export async function upsertTornItems(items: TornItemRow[]): Promise<void> {
  if (!items.length) return;

  const { error } = await supabase
    .from(TABLE_NAMES.TORN_ITEMS)
    .upsert(items, { onConflict: "item_id" });

  if (error) {
    throw new Error(`Failed to upsert torn items: ${error.message}`);
  }
}

export async function getValidApiKeys(): Promise<string[]> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.USERS)
    .select("api_key")
    .not("api_key", "is", null);

  if (error) {
    throw new Error(`Failed to fetch API keys: ${error.message}`);
  }

  return (data || [])
    .map((row) => {
      try {
        const encryptedKey = (row as any).api_key as string;
        return decrypt(encryptedKey);
      } catch (err) {
        console.error("Failed to decrypt API key:", err);
        return null;
      }
    })
    .filter((key) => key && key.length > 0) as string[];
}

export interface DestinationTravelTime {
  destination_id: number;
  standard: number;
  airstrip: number;
  wlt: number;
  bct: number;
  standard_w_book: number;
  airstrip_w_book: number;
  wlt_w_book: number;
  bct_w_book: number;
  standard_cost: number;
}

export async function getDestinationTravelTimes(): Promise<
  DestinationTravelTime[]
> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.DESTINATION_TRAVEL_TIMES)
    .select("*");

  if (error) {
    throw new Error(
      `Failed to fetch destination travel times: ${error.message}`,
    );
  }

  return (data || []) as DestinationTravelTime[];
}

export interface TravelRecommendation {
  user_id: string;
  destination_id: number;
  best_item_id?: number | null;
  profit_per_trip?: number | null;
  profit_per_minute?: number | null;
  round_trip_minutes?: number | null;
  recommendation_rank?: number | null;
  message?: string | null;
}

export async function upsertTravelRecommendations(
  recommendations: TravelRecommendation[],
): Promise<void> {
  if (!recommendations.length) return;

  // Get unique user IDs from recommendations
  const userIds = Array.from(new Set(recommendations.map((r) => r.user_id)));

  // Delete all existing recommendations for these users
  // This ensures stale recommendations disappear if no new ones are generated
  const { error: deleteError } = await supabase
    .from(TABLE_NAMES.TRAVEL_RECOMMENDATIONS)
    .delete()
    .in("user_id", userIds);

  if (deleteError) {
    throw new Error(
      `Failed to delete old recommendations: ${deleteError.message}`,
    );
  }

  // Insert fresh recommendations
  const { error: insertError } = await supabase
    .from(TABLE_NAMES.TRAVEL_RECOMMENDATIONS)
    .insert(recommendations);

  if (insertError) {
    throw new Error(
      `Failed to insert travel recommendations: ${insertError.message}`,
    );
  }
}
