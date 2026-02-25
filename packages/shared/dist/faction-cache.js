/**
 * Faction data caching module
 *
 * Implements a cache-first pattern for faction data:
 * 1. Check sentinel_torn_factions table for cached data
 * 2. If not found or expired, fetch from /faction/{id}/basic API
 * 3. Upsert result to database for future use
 * 4. Daily worker syncs all faction data
 */
import { TABLE_NAMES } from "./constants.js";
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
export async function getFactionDataCached(supabase, factionId, apiClient, apiKey) {
    // Try to get from cache
    const { data: cached } = await supabase
        .from(TABLE_NAMES.TORN_FACTIONS)
        .select("*")
        .eq("id", factionId)
        .single();
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
            console.warn(`[Faction Cache] API error fetching faction ${factionId}: ${response.error.error}`);
            return null;
        }
        const basic = response.basic;
        // Upsert to database
        const { data: upserted, error } = await supabase
            .from(TABLE_NAMES.TORN_FACTIONS)
            .upsert({
            id: basic.id,
            name: basic.name,
            tag: basic.tag,
            tag_image: basic.tag_image,
            leader_id: basic.leader_id,
            co_leader_id: basic.co_leader_id,
            respect: basic.respect,
            days_old: basic.days_old,
            capacity: basic.capacity,
            members: basic.members,
            is_enlisted: basic.is_enlisted,
            rank: basic.rank?.name || null,
            best_chain: basic.best_chain,
            note: basic.note || null,
            updated_at: new Date().toISOString(),
        }, { onConflict: "id" })
            .select()
            .single();
        if (error) {
            console.warn(`[Faction Cache] Failed to upsert faction ${factionId}: ${error.message}`);
            // Return API data even if cache write failed
            return {
                id: basic.id,
                name: basic.name,
                tag: basic.tag,
                tag_image: basic.tag_image,
                leader_id: basic.leader_id,
                co_leader_id: basic.co_leader_id,
                respect: basic.respect,
                days_old: basic.days_old,
                capacity: basic.capacity,
                members: basic.members,
                is_enlisted: basic.is_enlisted,
                rank: basic.rank?.name || null,
                best_chain: basic.best_chain,
                note: basic.note || null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
        }
        return upserted;
    }
    catch (error) {
        console.error(`[Faction Cache] Unexpected error fetching faction ${factionId}:`, error);
        return null;
    }
}
/**
 * Get faction name with caching (cache-first, API fallback if apiKey provided)
 * Returns null when not found or when no apiKey is available for live fetch.
 */
export async function getFactionNameCached(supabase, factionId, apiClient, apiKey) {
    const { data: cached } = await supabase
        .from(TABLE_NAMES.TORN_FACTIONS)
        .select("name")
        .eq("id", factionId)
        .maybeSingle();
    if (cached?.name) {
        return cached.name;
    }
    if (!apiKey) {
        return null;
    }
    const factionData = await getFactionDataCached(supabase, factionId, apiClient, apiKey);
    return factionData?.name ?? null;
}
/**
 * Batch get faction data with caching
 * @param supabase Supabase client
 * @param factionIds Array of faction IDs
 * @param apiClient TornApiClient instance
 * @param apiKey API key for Torn API calls
 * @returns Map of faction ID to faction data (missing factions not included)
 */
export async function getFactionDataBatchCached(supabase, factionIds, apiClient, apiKey) {
    const result = new Map();
    // Get all cached data
    const { data: cached } = await supabase
        .from(TABLE_NAMES.TORN_FACTIONS)
        .select("*")
        .in("id", factionIds);
    const cachedIds = new Set();
    if (cached) {
        for (const faction of cached) {
            result.set(faction.id, faction);
            cachedIds.add(faction.id);
        }
    }
    // Find missing IDs
    const missingIds = factionIds.filter((id) => !cachedIds.has(id));
    // Fetch missing from API
    for (const id of missingIds) {
        const data = await getFactionDataCached(supabase, id, apiClient, apiKey);
        if (data) {
            result.set(id, data);
        }
    }
    return result;
}
//# sourceMappingURL=faction-cache.js.map