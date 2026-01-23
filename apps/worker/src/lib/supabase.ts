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

export interface StockCacheRow {
  destination: string;
  item_name: string;
  item_id: number;
  quantity: number;
  cost: number;
  last_updated: string;
}

export interface TradeItemRow {
  item_id: number;
  name: string;
  category: string;
  is_active?: boolean;
}

export interface MarketTrendRow {
  item_id: number;
  item_name: string;
  lowest_market_price: number;
  last_updated?: string;
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

export async function insertStockCache(rows: StockCacheRow[]): Promise<void> {
  if (rows.length === 0) return;

  const { error } = await supabase
    .from("sentinel_travel_stock_cache")
    .insert(rows);

  if (error) {
    throw new Error(`Failed to insert stock cache: ${error.message}`);
  }
}

export async function cleanupOldStockCache(
  retentionDays: number = 7,
): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const { error } = await supabase
    .from("sentinel_travel_stock_cache")
    .delete()
    .lt("last_updated", cutoffDate.toISOString());

  if (error) {
    throw new Error(`Failed to cleanup stock cache: ${error.message}`);
  }
}

export async function upsertTradeItems(items: TradeItemRow[]): Promise<void> {
  if (items.length === 0) return;

  const { error } = await supabase.from(TABLE_NAMES.TRADE_ITEMS).upsert(items, {
    onConflict: "item_id",
  });

  if (error) {
    throw new Error(`Failed to upsert trade items: ${error.message}`);
  }
}

export async function getActiveTradeItemIds(): Promise<number[]> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.TRADE_ITEMS)
    .select("item_id")
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to fetch active trade items: ${error.message}`);
  }

  return (data || []).map((row) => (row as any).item_id as number);
}

export async function upsertMarketTrends(
  rows: MarketTrendRow[],
): Promise<void> {
  if (rows.length === 0) return;

  const { error } = await supabase
    .from(TABLE_NAMES.MARKET_TRENDS)
    .upsert(rows, {
      onConflict: "item_id",
    });

  if (error) {
    throw new Error(`Failed to upsert market trends: ${error.message}`);
  }
}

export async function getTradeItemNames(): Promise<Map<number, string>> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.TRADE_ITEMS)
    .select("item_id, name");

  if (error) {
    throw new Error(`Failed to fetch trade item names: ${error.message}`);
  }

  const map = new Map<number, string>();
  (data || []).forEach((row) => {
    map.set((row as any).item_id as number, (row as any).name as string);
  });

  return map;
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
