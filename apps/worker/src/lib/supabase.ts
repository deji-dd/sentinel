import { createClient } from "@supabase/supabase-js";
import { decrypt } from "./encryption.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getDB } from "@sentinel/shared/db/sqlite.js";

// Use local Supabase in development, cloud in production
const isDev = process.env.NODE_ENV === "development";
const supabaseUrl = isDev
  ? process.env.SUPABASE_URL_LOCAL || "http://127.0.0.1:54321"
  : process.env.SUPABASE_URL!;
const supabaseServiceKey = isDev
  ? process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL!
  : process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    `Missing Supabase credentials for ${isDev ? "local" : "cloud"} environment`,
  );
}

console.log(
  `[Supabase] Connected to ${isDev ? "local" : "cloud"} instance: ${supabaseUrl}`,
);

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function parseJsonArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
  }

  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item));
      }
    } catch {
      return [];
    }
  }

  return [];
}

function toSQLiteValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    return JSON.stringify(value);
  }

  return value;
}

function selectByUserIds<T>(tableName: string, userIds: string[]): T[] {
  if (!userIds.length) {
    return [];
  }

  const db = getDB();
  const placeholders = userIds.map(() => "?").join(", ");
  const sql = `SELECT * FROM ${quoteIdentifier(tableName)} WHERE user_id IN (${placeholders})`;
  return db.prepare(sql).all(...userIds) as T[];
}

function upsertRows(
  tableName: string,
  rows: Record<string, unknown>[],
  conflictColumns: string[],
): void {
  if (!rows.length) {
    return;
  }

  const db = getDB();
  const columns = Object.keys(rows[0]);
  const insertColumns = columns.map(quoteIdentifier).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const conflictList = conflictColumns.map(quoteIdentifier).join(", ");
  const updateColumns = columns
    .filter((column) => !conflictColumns.includes(column))
    .map(
      (column) =>
        `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`,
    )
    .join(", ");

  const tableIdentifier = quoteIdentifier(tableName);
  const insertSql =
    updateColumns.length > 0
      ? `INSERT INTO ${tableIdentifier} (${insertColumns}) VALUES (${placeholders}) ON CONFLICT(${conflictList}) DO UPDATE SET ${updateColumns}`
      : `INSERT OR IGNORE INTO ${tableIdentifier} (${insertColumns}) VALUES (${placeholders})`;

  const stmt = db.prepare(insertSql);
  const tx = db.transaction((batch: Record<string, unknown>[]) => {
    for (const row of batch) {
      const values = columns.map((column) => toSQLiteValue(row[column]));
      stmt.run(...values);
    }
  });

  tx(rows);
}

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
  category_id?: number | null;
}

export interface TravelSettings {
  user_id: string;
  alert_cooldown_minutes: number;
  blacklisted_items: number[];
  blacklisted_categories: number[];
  min_profit_per_trip?: number | null;
  min_profit_per_minute?: number | null;
}

export async function getAllUsers(): Promise<User[]> {
  const db = getDB();
  const rows = db
    .prepare(`SELECT * FROM ${quoteIdentifier(TABLE_NAMES.USERS)}`)
    .all() as User[];
  return rows;
}

export async function getTravelSettingsByUserIds(
  userIds: string[],
): Promise<Map<string, TravelSettings>> {
  const map = new Map<string, TravelSettings>();
  if (!userIds.length) return map;

  const rows = selectByUserIds<Record<string, unknown>>(
    TABLE_NAMES.TRAVEL_SETTINGS,
    userIds,
  );

  rows.forEach((row) => {
    map.set(row.user_id as string, {
      ...(row as unknown as TravelSettings),
      blacklisted_items: parseJsonArray(row.blacklisted_items),
      blacklisted_categories: parseJsonArray(row.blacklisted_categories),
    });
  });

  return map;
}

export async function getTravelDataByUserIds(
  userIds: string[],
): Promise<Map<string, TravelData>> {
  const map = new Map<string, TravelData>();
  if (!userIds.length) return map;

  const rows = selectByUserIds<TravelData>(TABLE_NAMES.TRAVEL_DATA, userIds);
  rows.forEach((row) => {
    map.set(row.user_id, row);
  });

  return map;
}

export async function upsertTravelData(updates: TravelData[]): Promise<void> {
  if (updates.length === 0) return;

  upsertRows(
    TABLE_NAMES.TRAVEL_DATA,
    updates as unknown as Record<string, unknown>[],
    ["user_id"],
  );
}

export async function upsertUserData(
  updates: UserProfileData[],
): Promise<void> {
  if (updates.length === 0) return;

  upsertRows(
    TABLE_NAMES.USER_DATA,
    updates as unknown as Record<string, unknown>[],
    ["user_id"],
  );
}

export async function upsertUserBars(updates: UserBarsData[]): Promise<void> {
  if (updates.length === 0) return;

  upsertRows(
    TABLE_NAMES.USER_BARS,
    updates as unknown as Record<string, unknown>[],
    ["user_id"],
  );
}

export async function getUserBarsByUserIds(
  userIds: string[],
): Promise<Map<string, UserBarsData>> {
  const map = new Map<string, UserBarsData>();
  if (!userIds.length) return map;

  const rows = selectByUserIds<UserBarsData>(TABLE_NAMES.USER_BARS, userIds);
  rows.forEach((row) => {
    map.set(row.user_id, row);
  });

  return map;
}

export async function upsertUserCooldowns(
  updates: UserCooldownsData[],
): Promise<void> {
  if (updates.length === 0) return;

  upsertRows(
    TABLE_NAMES.USER_COOLDOWNS,
    updates as unknown as Record<string, unknown>[],
    ["user_id"],
  );
}

export async function getUserCooldownsByUserIds(
  userIds: string[],
): Promise<Map<string, UserCooldownsData>> {
  const map = new Map<string, UserCooldownsData>();
  if (!userIds.length) return map;

  const rows = selectByUserIds<UserCooldownsData>(
    TABLE_NAMES.USER_COOLDOWNS,
    userIds,
  );
  rows.forEach((row) => {
    map.set(row.user_id, row);
  });

  return map;
}

export async function insertStockCache(rows: StockCacheRow[]): Promise<void> {
  if (rows.length === 0) return;

  const db = getDB();
  const tx = db.transaction((batch: StockCacheRow[]) => {
    const stmt = db.prepare(
      `INSERT INTO ${quoteIdentifier("sentinel_travel_stock_cache")} (destination_id, item_id, quantity, cost, last_updated)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const row of batch) {
      stmt.run(
        row.destination_id,
        row.item_id,
        row.quantity,
        row.cost,
        row.last_updated,
      );
    }
  });

  tx(rows);
}

export async function getTravelStockCache(): Promise<StockCacheRow[]> {
  const db = getDB();
  const result = db
    .prepare(
      `SELECT * FROM ${quoteIdentifier("sentinel_travel_stock_cache")} ORDER BY last_updated DESC, ingested_at DESC`,
    )
    .all() as StockCacheRow[];
  return result;
}

export interface TornDestinationRow {
  id: number;
  name: string;
  country_code: string;
}

export async function getDestinations(): Promise<TornDestinationRow[]> {
  const db = getDB();
  return db
    .prepare(
      `SELECT id, name, country_code FROM ${quoteIdentifier(TABLE_NAMES.TORN_DESTINATIONS)}`,
    )
    .all() as TornDestinationRow[];
}

export async function cleanupOldStockCache(
  retentionDays: number = 7,
): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const db = getDB();
  db.prepare(
    `DELETE FROM ${quoteIdentifier("sentinel_travel_stock_cache")} WHERE ingested_at < ?`,
  ).run(cutoffDate.toISOString());
}

export async function upsertTornItems(items: TornItemRow[]): Promise<void> {
  if (!items.length) return;

  upsertRows(
    TABLE_NAMES.TORN_ITEMS,
    items as unknown as Record<string, unknown>[],
    ["item_id"],
  );
}

export async function getTornItemsWithCategories(): Promise<
  Map<number, TornItemRow>
> {
  const db = getDB();
  const data = db
    .prepare(
      `SELECT item_id, name, image, type, category_id FROM ${quoteIdentifier(TABLE_NAMES.TORN_ITEMS)}`,
    )
    .all() as TornItemRow[];

  const map = new Map<number, TornItemRow>();
  (data || []).forEach((item) => {
    map.set(item.item_id, item);
  });

  return map;
}

/**
 * Sync torn categories - only inserts new categories, never updates.
 * This preserves category IDs across runs.
 */
export async function syncTornCategories(
  categoryNames: string[],
): Promise<void> {
  if (!categoryNames.length) return;

  const db = getDB();
  const existing = db
    .prepare(`SELECT name FROM ${quoteIdentifier(TABLE_NAMES.TORN_CATEGORIES)}`)
    .all() as Array<{ name: string }>;

  const existingNames = new Set(existing.map((c) => c.name));

  // Filter to only new categories
  const newCategories = categoryNames
    .filter((name) => !existingNames.has(name))
    .map((name) => ({ name }));

  if (newCategories.length > 0) {
    const stmt = db.prepare(
      `INSERT INTO ${quoteIdentifier(TABLE_NAMES.TORN_CATEGORIES)} (name) VALUES (?)`,
    );
    const tx = db.transaction((rows: Array<{ name: string }>) => {
      for (const row of rows) {
        stmt.run(row.name);
      }
    });
    tx(newCategories);
  }
}

export async function getValidApiKeys(): Promise<string[]> {
  const db = getDB();
  const data = db
    .prepare(
      `SELECT api_key FROM ${quoteIdentifier(TABLE_NAMES.USERS)} WHERE api_key IS NOT NULL`,
    )
    .all() as Array<{ api_key: string | null }>;

  return data
    .map((row) => {
      try {
        const encryptedKey = row.api_key as string;
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
  const db = getDB();
  return db
    .prepare(
      `SELECT * FROM ${quoteIdentifier(TABLE_NAMES.DESTINATION_TRAVEL_TIMES)}`,
    )
    .all() as DestinationTravelTime[];
}

export interface TravelRecommendation {
  user_id: string;
  destination_id: number;
  best_item_id?: number | null;
  profit_per_trip?: number | null;
  profit_per_minute?: number | null;
  round_trip_minutes?: number | null;
  cash_to_carry?: number | null;
  recommendation_rank?: number | null;
  message?: string | null;
}

export async function upsertTravelRecommendations(
  recommendations: TravelRecommendation[],
): Promise<void> {
  if (!recommendations.length) return;

  // Get unique user IDs from recommendations
  const userIds = Array.from(new Set(recommendations.map((r) => r.user_id)));

  const db = getDB();
  const placeholders = userIds.map(() => "?").join(", ");

  const tx = db.transaction((rows: TravelRecommendation[]) => {
    db.prepare(
      `DELETE FROM ${quoteIdentifier(TABLE_NAMES.TRAVEL_RECOMMENDATIONS)} WHERE user_id IN (${placeholders})`,
    ).run(...userIds);

    const columns = Object.keys(rows[0]);
    const insertColumns = columns.map(quoteIdentifier).join(", ");
    const valuePlaceholders = columns.map(() => "?").join(", ");
    const insertStmt = db.prepare(
      `INSERT INTO ${quoteIdentifier(TABLE_NAMES.TRAVEL_RECOMMENDATIONS)} (${insertColumns}) VALUES (${valuePlaceholders})`,
    );

    for (const row of rows) {
      const values = columns.map((column) =>
        toSQLiteValue((row as unknown as Record<string, unknown>)[column]),
      );
      insertStmt.run(...values);
    }
  });

  tx(recommendations);
}
