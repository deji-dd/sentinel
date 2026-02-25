/**
 * Faction data caching module
 *
 * Implements a cache-first pattern for faction data:
 * 1. Check sentinel_torn_factions table for cached data
 * 2. If not found or expired, fetch from /faction/{id}/basic API
 * 3. Upsert result to database for future use
 * 4. Daily worker syncs all faction data
 */
import { SupabaseClient } from "@supabase/supabase-js";
import type { TornApiClient } from "./torn.js";
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
 * @param supabase Supabase client
 * @param factionId Faction ID
 * @param apiClient TornApiClient instance
 * @param apiKey API key for Torn API calls
 * @returns Faction data or null if not found
 */
export declare function getFactionDataCached(supabase: SupabaseClient, factionId: number, apiClient: TornApiClient, apiKey: string): Promise<TornFactionData | null>;
/**
 * Get faction name with caching (cache-first, API fallback if apiKey provided)
 * Returns null when not found or when no apiKey is available for live fetch.
 */
export declare function getFactionNameCached(supabase: SupabaseClient, factionId: number, apiClient: TornApiClient, apiKey: string | null): Promise<string | null>;
/**
 * Batch get faction data with caching
 * @param supabase Supabase client
 * @param factionIds Array of faction IDs
 * @param apiClient TornApiClient instance
 * @param apiKey API key for Torn API calls
 * @returns Map of faction ID to faction data (missing factions not included)
 */
export declare function getFactionDataBatchCached(supabase: SupabaseClient, factionIds: number[], apiClient: TornApiClient, apiKey: string): Promise<Map<number, TornFactionData>>;
//# sourceMappingURL=faction-cache.d.ts.map