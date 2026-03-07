/**
 * Faction utilities for fetching and syncing faction information
 * Uses caching via sentinel_torn_factions table
 * Synced daily via faction-sync worker
 */

import { TABLE_NAMES } from "@sentinel/shared";
import { tornApi } from "../services/torn-client.js";
import { getDB } from "@sentinel/shared/db/sqlite.js";

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
    const db = getDB();
    let factionData = db
      .prepare(
        `SELECT * FROM "${TABLE_NAMES.TORN_FACTIONS}" WHERE id = ? LIMIT 1`,
      )
      .get(factionId) as { name?: string | null } | undefined;

    if (!factionData) {
      const response = await tornApi.get("/faction/{id}/basic", {
        apiKey,
        pathParams: { id: String(factionId) },
      });
      const basic = response.basic;

      if (basic?.id && basic?.name) {
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
          basic.tag_image,
          basic.leader_id,
          basic.co_leader_id,
          basic.respect,
          basic.days_old,
          basic.capacity,
          basic.members,
          basic.is_enlisted ? 1 : 0,
          basic.rank?.name || null,
          basic.best_chain,
          basic.note || null,
          new Date().toISOString(),
        );

        factionData = { name: basic.name };
      }
    }

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
    const db = getDB();
    db.prepare(
      `INSERT INTO "${TABLE_NAMES.FACTION_ROLES}" (guild_id, faction_id, member_role_ids, faction_name, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, faction_id) DO UPDATE SET
         member_role_ids = excluded.member_role_ids,
         faction_name = excluded.faction_name,
         updated_at = excluded.updated_at`,
    ).run(
      guildId,
      factionId,
      JSON.stringify(roleIds),
      factionName,
      new Date().toISOString(),
    );

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
      const db = getDB();
      for (const { id, name } of successfulResults) {
        try {
          // Update all rows with this faction_id across all guilds
          db.prepare(
            `UPDATE "${TABLE_NAMES.FACTION_ROLES}" SET faction_name = ?, updated_at = ? WHERE faction_id = ?`,
          ).run(name!, new Date().toISOString(), id);

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
