/**
 * Faction data sync worker
 * Runs once daily to update faction data in sentinel_torn_factions table
 * Uses system and guild API keys to distribute rate limit load
 */

import { TABLE_NAMES, TornApiClient } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase, getPersonalApiKey } from "../lib/supabase.js";
import { logDuration, logWarn, logError } from "../lib/logger.js";
import { tornApi } from "../services/torn-client.js";

export function startFactionSyncWorker() {
  return startDbScheduledRunner({
    worker: "faction_sync",
    defaultCadenceSeconds: 86400, // Run once daily (24 hours)
    handler: async () => {
      const startTime = Date.now();

      try {
        // Get all faction IDs we're tracking from guild faction role mappings
        const { data: factionRoles, error: queryError } = await supabase
          .from(TABLE_NAMES.FACTION_ROLES)
          .select("faction_id");

        if (queryError) {
          logError(
            "faction_sync",
            `Error fetching faction IDs: ${queryError.message}`,
          );
          return false;
        }

        const uniqueFactionIds = Array.from(
          new Set(
            factionRoles
              ?.map((row: any) => row.faction_id)
              .filter((id) => id != null) || [],
          ),
        ) as number[];

        if (uniqueFactionIds.length === 0) {
          logDuration(
            "faction_sync",
            "No factions to sync",
            Date.now() - startTime,
          );
          return true;
        }

        console.log(
          `[Faction Sync] Syncing ${uniqueFactionIds.length} factions`,
        );

        // Get available API key (system key)
        const apiKey = getPersonalApiKey();

        if (!apiKey) {
          logError("faction_sync", "No system API key available");
          return false;
        }

        // Sync faction data in batches using shared client with rate limiting
        let successCount = 0;
        let errorCount = 0;
        const batchSize = 10;

        for (let i = 0; i < uniqueFactionIds.length; i += batchSize) {
          const batch = uniqueFactionIds.slice(i, i + batchSize);

          // Process batch in parallel
          const promises = batch.map(async (factionId) => {
            try {
              const response = await tornApi.get("/faction/{id}/basic", {
                apiKey,
                pathParams: { id: String(factionId) },
              });

              if ("error" in response) {
                console.warn(
                  `[Faction Sync] API error for faction ${factionId}: ${(response as any).error.error}`,
                );
                return { success: false };
              }

              const basic = (response as any).basic;

              // Upsert to database
              const { error: upsertError } = await supabase
                .from(TABLE_NAMES.TORN_FACTIONS)
                .upsert(
                  {
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
                  },
                  { onConflict: "id" },
                );

              if (upsertError) {
                console.warn(
                  `[Faction Sync] Failed to upsert faction ${factionId}: ${upsertError.message}`,
                );
                return { success: false };
              }

              return { success: true };
            } catch (error) {
              console.error(
                `[Faction Sync] Unexpected error syncing faction ${factionId}:`,
                error,
              );
              return { success: false };
            }
          });

          const results = await Promise.all(promises);
          successCount += results.filter((r) => r.success).length;
          errorCount += results.filter((r) => !r.success).length;
        }

        const duration = Date.now() - startTime;
        console.log(
          `[Faction Sync] Completed: ${successCount}/${uniqueFactionIds.length} synced, ${errorCount} errors`,
        );
        logDuration(
          "faction_sync",
          `Synced ${successCount} factions`,
          duration,
        );

        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError("faction_sync", `Sync failed: ${message}`);
        return false;
      }
    },
  });
}
