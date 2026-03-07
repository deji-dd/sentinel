/**
 * Faction data caching module
 *
 * Implements a cache-first pattern for faction data:
 * 1. Check sentinel_torn_factions table for cached data
 * 2. If not found or expired, fetch from /faction/{id}/basic API
 * 3. Upsert result to database for future use
 * 4. Daily worker syncs all faction data
 */

import type { TornApiClient } from "./torn.js";
import { TABLE_NAMES } from "./constants.js";
import { getDB } from "./db/sqlite.js";

/** Faction data as stored in sentinel_torn_factions table */
export interface TornFactionData {
  id: number;
  name: string;
  tag: string;
  tag_image: string | null;
  leader_id: number | null;
  co_leader_id: number | null;
  respect: number;
  days_old: number | null;
  capacity: number;
  members: number;
  is_enlisted: boolean | null;
  rank: string | null;
  best_chain: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get faction data with caching
 *
 * Attempts to retrieve from cache first, then API if needed
 * @param factionId Faction ID
 * @param apiClient TornApiClient instance
 * @param apiKey API key for Torn API calls
 * @returns Faction data or null if not found
 */
export async function getFactionDataCached(
  factionId: number,
  apiClient: TornApiClient,
  apiKey: string,
): Promise<TornFactionData | null> {
  const db = getDB();
  // Try to get from cache
  const cached = db
    .prepare(
      `SELECT * FROM "${TABLE_NAMES.TORN_FACTIONS}" WHERE id = ? LIMIT 1`,
    )
    .get(factionId) as TornFactionData | undefined;

  if (cached) {
    return cached;
  }

  // Cache miss - fetch from API
  try {
    const response = await apiClient.get("/faction/{id}/basic", {
      apiKey,
      pathParams: { id: String(factionId) },
    });

    if ("error" in response) {
      console.warn(
        `[Faction Cache] API error fetching faction ${factionId}: ${response.error.error}`,
      );
      return null;
    }

    const basic = response.basic;
    const now = new Date().toISOString();

    // Upsert to database
    try {
      db.prepare(
        `INSERT INTO "${TABLE_NAMES.TORN_FACTIONS}"
         (id, name, tag, tag_image, leader_id, co_leader_id, respect, days_old, capacity, members, is_enlisted, rank, best_chain, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           tag = excluded.tag,
           tag_image = excluded.tag_image,
           leader_id = excluded.leader_id,
           co_leader_id = excluded.co_leader_id,
           respect = excluded.respect,
           days_old = excluded.days_old,
           capacity = excluded.capacity,
           members = excluded.members,
           is_enlisted = excluded.is_enlisted,
           rank = excluded.rank,
           best_chain = excluded.best_chain,
           note = excluded.note,
           updated_at = excluded.updated_at`,
      ).run(
        basic.id,
        basic.name,
        basic.tag,
        basic.tag_image || null,
        basic.leader_id || null,
        basic.co_leader_id || null,
        basic.respect,
        basic.days_old || null,
        basic.capacity,
        basic.members,
        basic.is_enlisted ? 1 : 0,
        basic.rank?.name || null,
        basic.best_chain || null,
        basic.note || null,
        now,
      );
    } catch (error) {
      console.warn(
        `[Faction Cache] Failed to upsert faction ${factionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Return API data even if cache write failed
      return {
        id: basic.id,
        name: basic.name,
        tag: basic.tag,
        tag_image: basic.tag_image || null,
        leader_id: basic.leader_id || null,
        co_leader_id: basic.co_leader_id || null,
        respect: basic.respect,
        days_old: basic.days_old || null,
        capacity: basic.capacity,
        members: basic.members,
        is_enlisted: basic.is_enlisted || null,
        rank: basic.rank?.name || null,
        best_chain: basic.best_chain || null,
        note: basic.note || null,
        created_at: now,
        updated_at: now,
      };
    }

    // Return the upserted data
    return {
      id: basic.id,
      name: basic.name,
      tag: basic.tag,
      tag_image: basic.tag_image || null,
      leader_id: basic.leader_id || null,
      co_leader_id: basic.co_leader_id || null,
      respect: basic.respect,
      days_old: basic.days_old || null,
      capacity: basic.capacity,
      members: basic.members,
      is_enlisted: basic.is_enlisted || null,
      rank: basic.rank?.name || null,
      best_chain: basic.best_chain || null,
      note: basic.note || null,
      created_at: now,
      updated_at: now,
    };
  } catch (error) {
    console.error(
      `[Faction Cache] Unexpected error fetching faction ${factionId}:`,
      error,
    );
    return null;
  }
}

/**
 * Get faction name with caching (cache-first, API fallback if apiKey provided)
 * Returns null when not found or when no apiKey is available for live fetch.
 */
export async function getFactionNameCached(
  factionId: number,
  apiClient: TornApiClient,
  apiKey: string | null,
): Promise<string | null> {
  const db = getDB();
  const cached = db
    .prepare(
      `SELECT name FROM "${TABLE_NAMES.TORN_FACTIONS}" WHERE id = ? LIMIT 1`,
    )
    .get(factionId) as { name: string } | undefined;

  if (cached?.name) {
    return cached.name;
  }

  if (!apiKey) {
    return null;
  }

  const factionData = await getFactionDataCached(factionId, apiClient, apiKey);

  return factionData?.name ?? null;
}

/**
 * Batch get faction data with caching
 * @param factionIds Array of faction IDs
 * @param apiClient TornApiClient instance
 * @param apiKey API key for Torn API calls
 * @returns Map of faction ID to faction data (missing factions not included)
 */
export async function getFactionDataBatchCached(
  factionIds: number[],
  apiClient: TornApiClient,
  apiKey: string,
): Promise<Map<number, TornFactionData>> {
  const db = getDB();
  const result = new Map<number, TornFactionData>();

  // Get all cached data
  const placeholders = factionIds.map(() => "?").join(",");
  const cached = db
    .prepare(
      `SELECT * FROM "${TABLE_NAMES.TORN_FACTIONS}" WHERE id IN (${placeholders})`,
    )
    .all(...factionIds) as TornFactionData[];

  const cachedIds = new Set<number>();
  for (const faction of cached) {
    result.set(faction.id, faction);
    cachedIds.add(faction.id);
  }

  // Find missing IDs
  const missingIds = factionIds.filter((id) => !cachedIds.has(id));

  // Fetch missing from API
  for (const id of missingIds) {
    const data = await getFactionDataCached(id, apiClient, apiKey);
    if (data) {
      result.set(id, data);
    }
  }

  return result;
}
