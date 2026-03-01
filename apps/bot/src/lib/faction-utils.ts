/**
 * Faction utilities for fetching and syncing faction information
 * Uses caching via sentinel_torn_factions table
 * Synced daily via faction-sync worker
 */

import { TABLE_NAMES, getFactionDataCached } from "@sentinel/shared";
import { tornApi } from "../services/torn-client.js";
import { supabase } from "./supabase.js";

/**
 * Validate and fetch faction details from Torn API (with caching)
 * Returns faction details (name, tag) if it exists, null if not
 * Stores result in sentinel_torn_factions table for future use
 */
export async function validateAndFetchFactionDetails(
  factionId: number,
  apiKey: string,
) {
  if (!apiKey) {
    return null;
  }

  try {
    const factionData = await getFactionDataCached(
      supabase,
      factionId,
      tornApi,
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
): Promise<boolean> {
  try {
    const { error } = await supabase.from(TABLE_NAMES.FACTION_ROLES).upsert(
      {
        guild_id: guildId,
        faction_id: factionId,
        member_role_ids: roleIds,
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
  apiKey: string,
): Promise<Map<number, string>> {
  const names = new Map<number, string>();

  if (factionIds.length === 0 || !apiKey) {
    return names;
  }

  // If too many missing factions, skip fetching to avoid rate limits
  // (faction names will be populated gradually over time)
  if (factionIds.length > 10) {
    console.warn(
      `[Faction Utils] Skipping bulk fetch of ${factionIds.length} faction names to avoid rate limiting`,
    );
    return names;
  }

  try {
    // Fetch factions with delays to respect rate limits
    // Instead of Promise.all, use sequential fetches with small delays
    const results = [];
    for (const id of factionIds) {
      try {
        const factionData = await tornApi.get("/faction/{id}/basic", {
          apiKey,
          pathParams: { id: String(id) },
        });
        results.push({ id, name: factionData.basic.name ?? null });
        // Small delay between API calls to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error fetching faction ${id}:`, error);
        results.push({ id, name: null });
      }
    }

    // Batch update database with new names
    const successfulResults = results.filter((r) => r.name !== null);
    if (successfulResults.length > 0) {
      for (const { id, name } of successfulResults) {
        try {
          // Update all rows with this faction_id across all guilds
          await supabase
            .from(TABLE_NAMES.FACTION_ROLES)
            .update({
              faction_name: name!,
              updated_at: new Date().toISOString(),
            })
            .eq("faction_id", id);

          names.set(id, name!);
        } catch (dbError) {
          console.error(`Error updating faction ${id} in database:`, dbError);
          // Continue with other factions even if one fails
        }
      }
    }

    return names;
  } catch (error) {
    console.error("Error fetching faction names:", error);
    return names;
  }
}
