/**
 * Sync faction names from Torn API to database
 * Verifies that faction data hasn't changed and updates any missing names
 *
 * Note: This worker requires a system API key to be configured.
 * For now, it's a placeholder that identifies jobs needing faction name updates.
 */

import { TABLE_NAMES } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { logDuration, logWarn } from "../lib/logger.js";

export function startFactionSyncWorker() {
  return startDbScheduledRunner({
    worker: "faction_sync",
    defaultCadenceSeconds: 86400, // 24 hours
    handler: async () => {
      const start = Date.now();

      try {
        // Get all faction role mappings with missing names
        const { data: factionRolesWithoutNames, error } = await supabase
          .from(TABLE_NAMES.FACTION_ROLES)
          .select("faction_id")
          .is("faction_name", null);

        if (
          error ||
          !factionRolesWithoutNames ||
          factionRolesWithoutNames.length === 0
        ) {
          logDuration(
            "faction_sync",
            "No factions missing names",
            Date.now() - start,
          );
          return true;
        }

        // Get all unique faction IDs that need syncing
        const factionIds = Array.from(
          new Set(
            (factionRolesWithoutNames as any[]).map((f: any) => f.faction_id),
          ),
        );

        logWarn(
          "faction_sync",
          `Found ${factionRolesWithoutNames.length} mappings with ${factionIds.length} unique factions to sync`,
        );

        // TODO: Implement faction name sync with system API key
        // Steps:
        // 1. Get or create system API key (configured in environment)
        // 2. Fetch faction names from Torn API for all missing IDs
        // 3. Update sentinel_faction_roles table with fetched names
        // 4. Log any API failures for manual investigation

        logDuration(
          "faction_sync",
          `Identified ${factionIds.length} faction names to sync`,
          Date.now() - start,
        );
        return true;
      } catch (error) {
        logWarn("faction_sync", `Error in faction sync: ${error}`);
        return true; // Return true to prevent repeat attempts
      }
    },
  });
}
