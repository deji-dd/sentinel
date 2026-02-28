/**
 * Faction utilities for fetching and syncing faction information
 * Uses caching via sentinel_torn_factions table
 * Synced daily via faction-sync worker
 */

import { botTornApi } from "./torn-api.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES, getFactionDataCached } from "@sentinel/shared";

/**
 * Validate and fetch faction details from Torn API (with caching)
 * Returns faction details (name, tag) if it exists, null if not
 * Stores result in sentinel_torn_factions table for future use
 */
export async function validateAndFetchFactionDetails(
  factionId: number,
  apiKey: string,
  supabase: SupabaseClient,
) {
  if (!apiKey) {
    return null;
  }

  try {
    const factionData = await getFactionDataCached(
      supabase,
      factionId,
      botTornApi,
      apiKey,
    );

    if (!factionData || !factionData.name) {
      return null;
    }

    return { name: factionData.name };
  } catch (error) {
    console.error(`Faction ${factionId} validation failed:`, error);
    return null;
  }
}

/**
 * Store faction details to database
 * Called after user has selected roles and submitted
 */
export async function storeFactionDetails(
  guildId: string,
  factionId: number,
  roleIds: string[],
  factionName: string,
  supabase: SupabaseClient,
): Promise<boolean> {
  try {
    const { error } = await supabase.from(TABLE_NAMES.FACTION_ROLES).upsert(
      {
        guild_id: guildId,
        faction_id: factionId,
        role_ids: roleIds,
        faction_name: factionName,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "guild_id,faction_id",
      },
    );

    if (error) {
      console.error("Error storing faction details:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error storing faction details:", error);
    return false;
  }
}

/**
 * Fetch multiple faction names from API and store in DB
 * Used by daily sync worker for batch updates
 */
export async function fetchAndStoreFactionNames(
  factionIds: number[],
  supabase: SupabaseClient,
  apiKey: string,
): Promise<Map<number, string>> {
  const names = new Map<number, string>();

  if (factionIds.length === 0 || !apiKey) {
    return names;
  }

  try {
    // Fetch all factions in parallel
    const fetchPromises = factionIds.map(async (id) => {
      try {
        const factionData = await botTornApi.get("/faction/{id}/basic", {
          apiKey,
          pathParams: { id: String(id) },
        });
        return { id, name: factionData.basic.name ?? null };
      } catch (error) {
        console.error(`Error fetching faction ${id}:`, error);
        return { id, name: null };
      }
    });

    const results = await Promise.all(fetchPromises);

    // Batch update database with new names
    const successfulResults = results.filter((r) => r.name !== null);
    if (successfulResults.length > 0) {
      for (const { id, name } of successfulResults) {
        // Update all rows with this faction_id across all guilds
        await supabase
          .from(TABLE_NAMES.FACTION_ROLES)
          .update({ faction_name: name!, updated_at: new Date().toISOString() })
          .eq("faction_id", id);

        names.set(id, name!);
      }
    }

    return names;
  } catch (error) {
    console.error("Error fetching faction names:", error);
    return names;
  }
}
