/**
 * Territory state sync worker
 * Runs with dynamic cadence based on number of available API keys
 * Fetches territory ownership data and syncs to DB
 * Triggers resolution handshake when ownership changes
 *
 * OPTIMIZATION STRATEGY:
 * 1. Hash-based detection: Compute hash of API responses (ownership + rackets)
 *    - If hash matches last run = no changes anywhere, skip DB processing
 *    - Saves ~1s of DB operations but still makes API calls (API is the bottleneck)
 * 2. Only upsert changed territories: Track specific territories that changed
 *    - Only update those rows instead of all 4,108 territories
 *    - Reduces DB upsert from ~1s to ~0.01s for small changes
 *
 * WORKFLOW:
 * 1. Fetch territory ownership from API (paginated) - ~7.5s
 * 2. Fetch racket data from API - ~0.5s
 * 3. Compute hash of combined data
 * 4. Compare with last run's hash from worker_schedules.metadata
 * 5. IF HASH MATCHES (no changes):
 *    - Log "No changes detected" and skip to step 10
 * 6. IF HASH DIFFERS:
 *    - Fetch current states from DB
 *    - Compare old vs new, detect changes
 *    - Build list of changed territories
 * 7. Only upsert changed territories to DB (not all 4,108)
 * 8. Send notifications for changes
 * 9. Store new hash in metadata
 * 10. Log completion stats
 *
 * Uses system API key for /faction/territoryownership endpoint with pagination
 */

import { createHash } from "crypto";
import { TABLE_NAMES, ApiKeyRotator } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { getAllSystemApiKeys } from "../lib/api-keys.js";
import { logDuration, logError } from "../lib/logger.js";
import {
  processAndDispatchNotifications,
  type TTEventNotification,
} from "../lib/tt-notification-dispatcher.js";
import { tornApi } from "../services/torn-client.js";
import { executeSync } from "../lib/sync.js";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

interface TTOwnershipChange {
  territory_id: string;
  old_faction_id: number | null;
  new_faction_id: number | null;
}

interface WorkerRow {
  id: string;
}

interface WorkerScheduleMetadataRow {
  metadata: string | null;
}

interface TerritoryBlueprintRow {
  id: string;
}

interface TerritoryStateFullRow {
  territory_id: string;
  faction_id: number | null;
  racket_name: string | null;
  racket_level: number | null;
  racket_created_at: number | null;
  racket_changed_at: number | null;
}

interface ActiveWarRow {
  territory_id: string;
  assaulting_faction: number;
  defending_faction: number;
  start_time: string;
}

function parseScheduleMetadata(metadata: string | null): {
  response_hash?: string;
  consecutive_no_change_runs?: number;
} {
  if (!metadata) {
    return {};
  }

  try {
    const parsed = JSON.parse(metadata) as {
      response_hash?: string;
      consecutive_no_change_runs?: number;
    };
    return parsed || {};
  } catch {
    return {};
  }
}

function buildFactionTerritoryCountMap(
  rows: Array<{ faction_id?: number | null; owned_by?: number | null }>,
  key: "faction_id" | "owned_by",
): Map<number, number> {
  const counts = new Map<number, number>();

  for (const row of rows) {
    const factionId = normalizeFactionId(row[key]);
    if (!factionId) {
      continue;
    }

    counts.set(factionId, (counts.get(factionId) || 0) + 1);
  }

  return counts;
}

function normalizeFactionId(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Compute SHA-256 hash of API response data
 * Used to detect if anything changed since last sync run
 */
function computeResponseHash(
  ownershipData: unknown[],
  racketData: Record<string, unknown>,
): string {
  // Create deterministic string representation
  const combined = JSON.stringify({
    ownership: ownershipData,
    rackets: racketData,
  });
  return createHash("sha256").update(combined).digest("hex");
}

// Cache worker ID at module level (never changes)
let cachedWorkerId: string | null = null;

async function getWorkerId(): Promise<string | null> {
  if (cachedWorkerId) return cachedWorkerId;

  const db = getKysely();
  const worker = (await db
    .selectFrom(TABLE_NAMES.WORKERS)
    .select("id")
    .where("name", "=", "territory_state_sync")
    .limit(1)
    .executeTakeFirst()) as WorkerRow | undefined;

  cachedWorkerId = worker?.id || null;
  return cachedWorkerId;
}

/**
 * Get worker metadata from scheduler table
 */
async function getWorkerMetadata(): Promise<{
  response_hash?: string;
  consecutive_no_change_runs?: number;
}> {
  const workerId = await getWorkerId();
  if (!workerId) return {};

  const db = getKysely();
  const schedule = (await db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
    .select("metadata")
    .where("worker_id", "=", workerId)
    .limit(1)
    .executeTakeFirst()) as WorkerScheduleMetadataRow | undefined;

  return parseScheduleMetadata(schedule?.metadata || null);
}

/**
 * Update worker metadata in scheduler table
 */
async function updateWorkerMetadata(metadata: {
  response_hash?: string;
  consecutive_no_change_runs?: number;
}): Promise<void> {
  const workerId = await getWorkerId();
  if (!workerId) return;

  const db = getKysely();
  await db
    .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
    .set({ metadata: JSON.stringify(metadata) })
    .where("worker_id", "=", workerId)
    .execute();
}

/**
 * Calculate dynamic cadence based on number of available API keys
 * Current sync loop makes ~11 API calls per run (9 ownership pages + 1 racket + 1 buffer)
 * With parallel pagination, all requests happen simultaneously (~1s total)
 * Torn API rate limit: 50 req/min per key (safety buffer from 100/min)
 * Formula: (11 requests × 60 seconds) / (numKeys × 50 req/min)
 *
 * Examples:
 * - 1 key: 11×60 / (1×50) = 13 seconds (to stay under 50/min limit)
 * - 2 keys: 11×60 / (2×50) = 7 seconds
 * - 4 keys: 11×60 / (4×50) = 4 seconds
 *
 * Note: Actual sync time is ~2-3s (parallel API + DB), but cadence accounts
 * for rate limit spacing across multiple sync runs.
 *
 * Dynamically counts actual system keys from database.
 */
async function calculateCadence(): Promise<number> {
  const requestsNeeded = 11; // 9 ownership pages + 1 racket + 1 buffer
  const limitPerKeyPerMin = 50; // Torn limit is 100, using 50 for safety

  // Count actual system keys available
  const apiKeys = await getAllSystemApiKeys("system");
  const numKeys = Math.max(1, apiKeys.length);

  // cadence = (requests needed × 60s) / (keys available × limit per key)
  const dynamicCadence = Math.ceil(
    (requestsNeeded * 60) / (numKeys * limitPerKeyPerMin),
  );

  // Clamp between 4s (minimum safe for rate limits) and 120s (reasonable max)
  return Math.max(4, Math.min(120, dynamicCadence));
}

/**
 * Detect if worker is doing a catch-up sync (missed multiple sync cycles)
 * Returns true if last execution was more than 2x expected cadence ago
 */
async function isCatchUpSync(expectedCadenceSeconds: number): Promise<boolean> {
  const db = getKysely();
  const worker = (await db
    .selectFrom(TABLE_NAMES.WORKERS)
    .select("id")
    .where("name", "=", "territory_state_sync")
    .limit(1)
    .executeTakeFirst()) as WorkerRow | undefined;

  if (!worker?.id) {
    return false;
  }

  // Get schedule info from sentinel_worker_schedules
  const schedules = (await db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
    .select("last_run_at")
    .where("worker_id", "=", worker.id)
    .limit(1)
    .executeTakeFirst()) as { last_run_at: string | null } | undefined;

  if (!schedules?.last_run_at) {
    return false; // First run or no schedule state
  }

  const lastRunTime = new Date(schedules.last_run_at).getTime();
  const timeSinceLastRun = Date.now() - lastRunTime;
  const expectedInterval = expectedCadenceSeconds * 1000;
  const catchUpThreshold = expectedInterval * 2.5; // Allow 2.5x cadence as normal variance

  return timeSinceLastRun > catchUpThreshold;
}

/**
 * Determine ownership change event types
 * NOTE: War outcome notifications (assault_succeeded/failed) are handled
 * exclusively by war-ledger-sync to prevent duplicates. This only handles
 * non-war ownership changes.
 *
 * IMPORTANT: Can return multiple events for the case where faction A drops
 * and faction B claims before the bot detects - both "dropped" and "claimed"
 * events are generated to properly log the full transition.
 */
function determineEventTypes(
  oldFaction: number | null,
  newFaction: number | null,
  activeWar: { assaulting_faction: number; defending_faction: number } | null,
): Array<{
  type: TTEventNotification["event_type"];
  factionId: number | null;
}> {
  if (activeWar) {
    // War is active - war-ledger-sync will handle outcome notifications
    // Don't send duplicate assault_succeeded/assault_failed here
    return [];
  }

  const events: Array<{
    type: TTEventNotification["event_type"];
    factionId: number | null;
  }> = [];

  // Case 1: Faction dropped (X -> null)
  if (oldFaction !== null && newFaction === null) {
    events.push({ type: "dropped", factionId: oldFaction });
  }
  // Case 2: New faction claimed empty territory (null -> X)
  else if (oldFaction === null && newFaction !== null) {
    events.push({ type: "claimed", factionId: newFaction });
  }
  // Case 3: Faction A dropped and faction B claimed before sync detected (A -> B)
  // This generates BOTH a "dropped" event for A and a "claimed" event for B
  else if (
    oldFaction !== null &&
    newFaction !== null &&
    oldFaction !== newFaction
  ) {
    events.push({ type: "dropped", factionId: oldFaction });
    events.push({ type: "claimed", factionId: newFaction });
  }

  return events;
}

/**
 * Check if guild should be notified about this TT change
 */
function _shouldNotifyGuild(
  config: {
    notification_type: string;
    territory_ids?: string[];
    faction_ids?: number[];
  },
  event: TTEventNotification,
): boolean {
  if (config.notification_type === "all") {
    return true;
  }

  if (config.notification_type === "territories" && config.territory_ids) {
    return config.territory_ids.includes(event.territory_id);
  }

  if (config.notification_type === "factions" && config.faction_ids) {
    // Notify if any relevant faction involved
    const relevantFactions = [
      event.occupying_faction,
      event.assaulting_faction,
      event.defending_faction,
    ].filter((f) => f !== undefined && f !== null);
    return relevantFactions.some((f) => config.faction_ids?.includes(f));
  }

  // Shouldn't reach here
  return false;
}

/**
 * Queue event notification for guild processing
 * Dispatches to bot webhook via HTTP for delivery to Discord
 */
async function queueGuildNotifications(
  _changes: TTOwnershipChange[],
  notifications: TTEventNotification[],
): Promise<void> {
  if (notifications.length === 0) {
    return;
  }

  // Fire notification dispatcher asynchronously without blocking sync
  // (processAndDispatchNotifications returns immediately, queues work internally)
  processAndDispatchNotifications(notifications);
}

export function startTerritoryStateSyncWorker() {
  return startDbScheduledRunner({
    worker: "territory_state_sync",
    defaultCadenceSeconds: 96, // Will be updated based on key count
    getDynamicCadence: calculateCadence,
    handler: async () => {
      await executeSync({
        name: "territory_state_sync",
        timeout: 180_000, // 3 minutes max (allows for rate limiting delays)
        handler: async () => {
          const startTime = Date.now();
          const db = getKysely();

          try {
            // Get system API keys and initialize rotator for load balancing
            const apiKeys = await getAllSystemApiKeys("system");
            if (!apiKeys.length) {
              // Silently skip if no system key
              return;
            }

            // Create API key rotator to distribute requests across all available keys
            const keyRotator = new ApiKeyRotator(apiKeys);

            // Get all territory IDs (with explicit limit to bypass default 1000-row limit)
            const allTTs = (await db
              .selectFrom(TABLE_NAMES.TERRITORY_BLUEPRINT)
              .select("id")
              .orderBy("id", "asc")
              .limit(5000)
              .execute()) as TerritoryBlueprintRow[]; // Explicit limit - must be <= config.toml max_rows setting

            if (!allTTs || allTTs.length === 0) {
              logDuration(
                "territory_state_sync",
                "No territories in blueprint",
                Date.now() - startTime,
              );
              return;
            }

            const ttIds = allTTs.map((tt) => tt.id);

            // Check if this is initial seeding (avoid flooding channel with notifications)
            const existingStatesRow = await db
              .selectFrom(TABLE_NAMES.TERRITORY_STATE)
              .select((eb) => eb.fn.count("territory_id").as("count"))
              .executeTakeFirst();
            const existingStates = Number(existingStatesRow?.count ?? 0);

            const isInitialSeeding =
              !existingStates || existingStates < ttIds.length * 0.05; // Less than 5% seeded

            // Check if worker is doing a catch-up sync (suppress notifications to avoid false positives)
            const cadence = await calculateCadence();
            const isCatchUp = await isCatchUpSync(cadence);

            if (isCatchUp) {
              logDuration(
                "territory_state_sync",
                `Catch-up sync detected (>2.5x cadence gap) - ownership notifications will be suppressed this run`,
                0,
              );
            }

            // Fetch territory ownership data using optimal pagination
            const changes: TTOwnershipChange[] = [];
            const notifications: TTEventNotification[] = [];

            // OPTIMIZATION: Parallel pagination instead of sequential
            // We know there are ~4108 territories, so calculate all offsets upfront
            // and fetch them in parallel (9 requests in ~1s instead of ~9s)
            const limit = 500;
            const estimatedTerritoryCount = ttIds.length; // ~4108
            const pageCount = Math.ceil(estimatedTerritoryCount / limit);
            const offsets = Array.from(
              { length: pageCount },
              (_, i) => i * limit,
            );

            // Fetch all pages in parallel with key rotation
            const responses = await Promise.all(
              offsets.map((offset) =>
                tornApi.get("/faction/territoryownership", {
                  apiKey: keyRotator.getNextKey(),
                  queryParams: { offset, limit },
                }),
              ),
            );

            // Combine all territories from parallel responses
            const allOwnershipData = responses.flatMap(
              (response) => response.territoryOwnership || [],
            );

            // Fetch racket data from v1 API
            // TornApiClient throws errors on API failures - caught by outer try-catch
            const racketResponse = await tornApi.getRaw<{
              rackets?: Record<
                string,
                {
                  name: string;
                  level: number;
                  reward: string;
                  created: number;
                  changed: number;
                  faction: number;
                }
              >;
            }>("/torn", keyRotator.getNextKey(), { selections: "rackets" });

            const racketsByTerritory = racketResponse.rackets || {};

            // OPTIMIZATION: Hash-based detection
            // Compute hash of API responses to detect if anything changed
            const currentHash = computeResponseHash(
              allOwnershipData,
              racketsByTerritory,
            );
            const metadata = await getWorkerMetadata();
            const lastHash = metadata.response_hash;

            // If hash matches last run, nothing changed - skip DB processing
            if (lastHash && currentHash === lastHash) {
              const duration = Date.now() - startTime;
              logDuration(
                "territory_state_sync",
                `No changes detected (hash match) for ${allOwnershipData.length} territories`,
                duration,
              );

              // Track consecutive no-change runs for future adaptive cadence
              const consecutiveNoChangeRuns =
                (metadata.consecutive_no_change_runs || 0) + 1;
              await updateWorkerMetadata({
                response_hash: currentHash,
                consecutive_no_change_runs: consecutiveNoChangeRuns,
              });

              return; // Early exit - no DB updates needed
            }

            // Hash differs or first run - proceed with full sync
            // Batch-fetch all territory states at once (avoid N+1 queries)
            const allCurrentStates = (await db
              .selectFrom(TABLE_NAMES.TERRITORY_STATE)
              .select([
                "territory_id",
                "faction_id",
                "racket_name",
                "racket_level",
                "racket_created_at",
                "racket_changed_at",
              ])
              .execute()) as TerritoryStateFullRow[];

            const statesByTerritory = new Map(
              (allCurrentStates || []).map((s) => [s.territory_id, s]),
            );

            // Batch-fetch all active wars at once (avoid N+1 queries)
            const allActiveWars = (await db
              .selectFrom(TABLE_NAMES.WAR_LEDGER)
              .select([
                "territory_id",
                "assaulting_faction",
                "defending_faction",
                "start_time",
              ])
              .where("end_time", "is", null)
              .execute()) as ActiveWarRow[];

            const warsByTerritory = new Map(
              (allActiveWars || []).map((w) => [w.territory_id, w]),
            );

            // Process ownership and racket data, detect all changes
            // OPTIMIZATION: Track specific territories that changed
            const changedTerritories = new Set<string>();

            for (const tt of allOwnershipData) {
              const currentState = statesByTerritory.get(tt.id);

              const oldFaction = normalizeFactionId(currentState?.faction_id);
              const newFaction = normalizeFactionId(tt.owned_by);

              // Get racket data for this territory
              const racket = racketsByTerritory[tt.id];
              const oldRacketName = currentState?.racket_name ?? null;
              const oldRacketLevel = currentState?.racket_level ?? null;
              const newRacketName = racket?.name ?? null;
              const newRacketLevel = racket?.level ?? null;

              // Detect ownership changes
              if (oldFaction !== newFaction) {
                changedTerritories.add(tt.id); // Track this territory changed
                changes.push({
                  territory_id: tt.id,
                  old_faction_id: oldFaction,
                  new_faction_id: newFaction,
                });

                // Check for active war to determine event type(s)
                const activeWar = warsByTerritory.get(tt.id);

                const events = determineEventTypes(
                  oldFaction,
                  newFaction,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  activeWar as any,
                );

                // Add notifications for all detected events
                // (can be multiple events: e.g., faction A dropped + faction B claimed)
                for (const event of events) {
                  notifications.push({
                    guild_id: "",
                    territory_id: tt.id,
                    event_type: event.type,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    assaulting_faction: (activeWar as any)?.assaulting_faction,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    defending_faction: (activeWar as any)?.defending_faction,
                    occupying_faction:
                      event.type === "claimed" ? newFaction : null,
                    previous_faction:
                      event.type === "dropped" ? event.factionId : undefined,
                  });
                }
              }

              // Detect racket changes
              if (
                oldRacketName !== newRacketName ||
                oldRacketLevel !== newRacketLevel
              ) {
                changedTerritories.add(tt.id); // Track this territory changed
                // Racket spawned
                if (!oldRacketName && newRacketName) {
                  notifications.push({
                    guild_id: "",
                    territory_id: tt.id,
                    event_type: "racket_spawned",
                    occupying_faction: newFaction,
                    racket_name: newRacketName,
                    racket_new_level: newRacketLevel,
                  });
                }
                // Racket despawned
                else if (oldRacketName && !newRacketName) {
                  notifications.push({
                    guild_id: "",
                    territory_id: tt.id,
                    event_type: "racket_despawned",
                    occupying_faction: oldFaction,
                    racket_name: oldRacketName,
                    racket_old_level: oldRacketLevel ?? undefined,
                  });
                }
                // Racket type changed (different racket spawned)
                else if (
                  oldRacketName &&
                  newRacketName &&
                  oldRacketName !== newRacketName
                ) {
                  // Send both despawn and spawn notifications
                  notifications.push({
                    guild_id: "",
                    territory_id: tt.id,
                    event_type: "racket_despawned",
                    occupying_faction: oldFaction,
                    racket_name: oldRacketName,
                    racket_old_level: oldRacketLevel ?? undefined,
                  });
                  notifications.push({
                    guild_id: "",
                    territory_id: tt.id,
                    event_type: "racket_spawned",
                    occupying_faction: newFaction,
                    racket_name: newRacketName,
                    racket_new_level: newRacketLevel,
                  });
                }
                // Racket level changed
                else if (
                  oldRacketName === newRacketName &&
                  oldRacketLevel !== newRacketLevel
                ) {
                  console.log(
                    `[DEBUG] Racket level changed detected: TT ${tt.id}, ${oldRacketName}, ${oldRacketLevel} -> ${newRacketLevel}`,
                  );
                  notifications.push({
                    guild_id: "",
                    territory_id: tt.id,
                    event_type: "racket_level_changed",
                    occupying_faction: newFaction,
                    racket_name: newRacketName,
                    racket_old_level: oldRacketLevel ?? undefined,
                    racket_new_level: newRacketLevel,
                  });
                }
              }
            }

            const oldTerritoryCounts = buildFactionTerritoryCountMap(
              (allCurrentStates || []).map((row) => ({
                faction_id: normalizeFactionId(row.faction_id),
              })),
              "faction_id",
            );
            const newTerritoryCounts = buildFactionTerritoryCountMap(
              allOwnershipData.map((row) => ({
                owned_by: normalizeFactionId(row.owned_by),
              })),
              "owned_by",
            );

            const factionsThatLostTerritory = Array.from(
              new Set(
                changes
                  .map((change) => change.old_faction_id)
                  .filter(
                    (factionId): factionId is number => factionId !== null,
                  ),
              ),
            );

            for (const factionId of factionsThatLostTerritory) {
              const oldCount = oldTerritoryCounts.get(factionId) || 0;
              const newCount = newTerritoryCounts.get(factionId) || 0;

              if (oldCount > 0 && newCount === 0) {
                const finalLoss = changes
                  .filter((change) => change.old_faction_id === factionId)
                  .at(-1);

                if (finalLoss) {
                  notifications.push({
                    guild_id: "",
                    territory_id: finalLoss.territory_id,
                    event_type: "desectored",
                    occupying_faction: finalLoss.new_faction_id,
                    previous_faction: factionId,
                    defending_faction: factionId,
                    assaulting_faction: finalLoss.new_faction_id || undefined,
                  });
                }
              }
            }

            // OPTIMIZATION: Only upsert territories that actually changed
            // Instead of upserting all 4,108 territories, only update changed ones
            if (changedTerritories.size > 0) {
              const stateUpdates = Array.from(changedTerritories).map(
                (territoryId) => {
                  const ownershipData = allOwnershipData.find(
                    (t) => t.id === territoryId,
                  );
                  const racketData = racketsByTerritory[territoryId];

                  return {
                    territory_id: territoryId,
                    faction_id: normalizeFactionId(ownershipData?.owned_by),
                    racket_name: racketData?.name ?? null,
                    racket_level: racketData?.level ?? null,
                    racket_reward: racketData?.reward ?? null,
                    racket_created_at: racketData?.created ?? null,
                    racket_changed_at: racketData?.changed ?? null,
                  };
                },
              );

              try {
                await db.transaction().execute(async (trx) => {
                  for (const row of stateUpdates) {
                    await trx
                      .insertInto(TABLE_NAMES.TERRITORY_STATE)
                      .values(row)
                      .onConflict((oc) =>
                        oc.column("territory_id").doUpdateSet({
                          faction_id: row.faction_id,
                          racket_name: row.racket_name,
                          racket_level: row.racket_level,
                          racket_reward: row.racket_reward,
                          racket_created_at: row.racket_created_at,
                          racket_changed_at: row.racket_changed_at,
                        }),
                      )
                      .execute();
                  }
                });
              } catch (error) {
                logError(
                  "territory_state_sync",
                  `Failed to update territory states: ${error instanceof Error ? error.message : String(error)}`,
                );
                throw error;
              }

              // Queue guild notifications
              // Skip ownership notifications if: initial seeding OR catch-up sync
              // BUT always send racket notifications (low false-positive rate)
              const ownershipNotifications = notifications.filter((n) =>
                [
                  "assault_succeeded",
                  "assault_failed",
                  "dropped",
                  "claimed",
                  "desectored",
                ].includes(n.event_type),
              );
              const racketNotifications = notifications.filter((n) =>
                [
                  "racket_spawned",
                  "racket_despawned",
                  "racket_level_changed",
                ].includes(n.event_type),
              );

              const notificationsToSend = [
                ...racketNotifications, // Always send racket notifications
                ...(!isInitialSeeding && !isCatchUp
                  ? ownershipNotifications
                  : []), // Only send ownership if not catching up
              ];

              if (notificationsToSend.length > 0) {
                await queueGuildNotifications(changes, notificationsToSend);
              }

              // If catch-up sync, log suppressed ownership notification count
              if (isCatchUp && ownershipNotifications.length > 0) {
                logDuration(
                  "territory_state_sync",
                  `Suppressed ${ownershipNotifications.length} ownership change notification(s) during catch-up (racket notifications still sent)`,
                  0,
                );
              }
            }

            const ownershipChanges = notifications.filter((n) =>
              [
                "assault_succeeded",
                "assault_failed",
                "dropped",
                "claimed",
                "desectored",
              ].includes(n.event_type),
            ).length;
            const racketChanges = notifications.filter((n) =>
              [
                "racket_spawned",
                "racket_despawned",
                "racket_level_changed",
              ].includes(n.event_type),
            ).length;
            const racketSpawned = notifications.filter(
              (n) => n.event_type === "racket_spawned",
            ).length;
            const racketDespawned = notifications.filter(
              (n) => n.event_type === "racket_despawned",
            ).length;
            const racketLevelChanged = notifications.filter(
              (n) => n.event_type === "racket_level_changed",
            ).length;

            // Store new hash and reset consecutive no-change counter
            await updateWorkerMetadata({
              response_hash: currentHash,
              consecutive_no_change_runs: 0,
            });

            const duration = Date.now() - startTime;
            logDuration(
              "territory_state_sync",
              `Sync completed for ${allOwnershipData.length} territories (${ownershipChanges} ownership, ${racketChanges} racket changes [${racketSpawned} spawned, ${racketDespawned} despawned, ${racketLevelChanged} level changed], ${changedTerritories.size} DB updates)`,
              duration,
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            logError("territory_state_sync", `Failed: ${message}`);
            throw error; // Re-throw so executeSync knows this failed
          }
        },
      });
    },
  });
}
