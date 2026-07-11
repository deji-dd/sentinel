import { executeSync } from "../../lib/sync.js";
import { Logger, TornFactions } from "@sentinel/shared";
import { dispatchToBot } from "../../lib/ipc.js";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import { tornApi, getSystemKeyPool } from "@sentinel/shared";
import { TerritoryStates, WarLedger, WorkerSchedules } from "@sentinel/shared";
import type { TornSchema } from "@sentinel/shared";
import type {
  TerritoryStateDocument,
  WarLedgerDocument,
} from "@sentinel/shared";

const WORKER_NAME = "territory_activity";
const logger = new Logger(WORKER_NAME);

// Global state to ensure the rotation never resets, protecting your rate limits
let keyIndex = 0;

// ==========================================
// TYPE DEFINITIONS
// ==========================================

type ApiRacket = TornSchema<"TornRacket">;
type ApiOwnership = TornSchema<"FactionTerritoryOwnership">;

// Explicit interface for the V1 global territory wars state dump
interface ApiTerritoryWarV1 {
  assaulting_faction: number;
  defending_faction: number;
  score: number;
  required_score: number;
  start_time: number;
  end_time: number;
  territory: string;
}

// ==========================================
// UTILITIES
// ==========================================

/**
 * Calculates the fastest possible polling cadence that safely respects
 * the 50 requests-per-minute API rate limit across all available keys.
 * * @param {number} keyCount - Total system API keys available in the database pool
 * @param {number} requestsPerLoop - Total HTTP endpoints hit per execution cycle
 * @returns {number} The optimal loop delay in seconds
 */
function calculateOptimalCadence(
  keyCount: number,
  requestsPerLoop: number,
): number {
  const maxRequestsPerMinute = keyCount * 30;
  // Leave a 5% safety buffer to prevent 429 errors from other background workers
  const safeRequestsPerMinute = maxRequestsPerMinute * 1.0;
  const maxLoopsPerMinute = Math.floor(safeRequestsPerMinute / requestsPerLoop);
  return Number((60 / maxLoopsPerMinute).toFixed(2));
}

// ==========================================
// CORE ENGINE
// ==========================================

/**
 * Fetches, diffs, and resolves the entire state of Torn's territory map.
 * Reconciles ownership, rackets, and warfare simultaneously to prevent race conditions.
 */
async function executeActivityEngine(): Promise<void> {
  const finishLog = logger.time("Running Territory Activity Engine.");

  try {
    const keys = getSystemKeyPool();
    const getKey = () => keys[keyIndex++ % keys.length];

    // 9 pages of 500 perfectly covers the ~4,108 limit
    const offsets = Array.from({ length: 9 }, (_, i) => i * 500);

    const [racketsRes, warfareRes, ...ownershipResPages] = await Promise.all([
      tornApi.get("/faction/rackets", { apiKey: getKey() }) as Promise<
        TornSchema<"FactionRacketsResponse">
      >,
      // Switching to V1 global endpoint to bypass pagination limits
      tornApi.getRaw("/torn", getKey(), {
        selections: "territorywars",
      }) as Promise<{ territorywars?: Record<string, ApiTerritoryWarV1> }>,
      ...offsets.map(
        (offset) =>
          tornApi.get("/faction/territoryownership", {
            apiKey: getKey(),
            queryParams: { limit: 500, offset },
          }) as Promise<TornSchema<"FactionTerritoriesOwnershipResponse">>,
      ),
    ]);

    // Normalize Data based on v2 typings and explicitly cast to our strict interfaces
    const apiWarsMap = warfareRes.territorywars || {};
    const apiRackets = (racketsRes.rackets || []) as ApiRacket[];
    const apiOwnership = ownershipResPages.flatMap(
      (page) => page.territoryOwnership || [],
    ) as ApiOwnership[];

    const dbStates = new Map(TerritoryStates.findAll().map((s) => [s.id, s]));
    const dbActiveWars = new Map(
      WarLedger.findAll((w) => w.end_time === null).map((w) => [w.id, w]),
    );

    const stateUpserts: TerritoryStateDocument[] = [];
    const warUpserts: WarLedgerDocument[] = [];
    let eventsEmitted = 0;

    // ==========================================
    // PHASE 1: WAR RESOLUTION
    // ==========================================
    const activeApiWarIds = new Set(Object.keys(apiWarsMap));

    // Resolve ENDED Wars
    for (const [warId, dbWar] of dbActiveWars) {
      if (!activeApiWarIds.has(warId)) {
        const currentOwner =
          apiOwnership.find((o) => o.id === dbWar.territory_id)?.owned_by ||
          null;

        dbWar.end_time = Date.now();
        dbWar.victor_faction = currentOwner;
        warUpserts.push(dbWar);

        const isTruce =
          Date.now() - dbWar.start_time < 72 * 3600000 &&
          currentOwner === dbWar.defending_faction;
        const type = isTruce
          ? "peace_treaty"
          : currentOwner === dbWar.assaulting_faction
            ? "assault_succeeded"
            : "assault_failed";

        dispatchToBot("TERRITORY_EVENT", {
          eventType: type,
          data: { war: dbWar },
        });
        eventsEmitted++;
      }
    }

    // Register NEW Wars
    for (const [warId, war] of Object.entries(apiWarsMap)) {
      if (!dbActiveWars.has(warId)) {
        warUpserts.push({
          id: warId,
          territory_id: war.territory,
          // V1 maps these directly as top-level integers
          assaulting_faction: war.assaulting_faction,
          defending_faction: war.defending_faction,
          victor_faction: null,
          start_time: war.start_time * 1000,
          end_time: null,
        } as WarLedgerDocument);

        dispatchToBot("TERRITORY_EVENT", {
          eventType: "war_started",
          data: { territory: war.territory, data: war },
        });
        eventsEmitted++;
      }
    }

    // ==========================================
    // PHASE 2: OWNERSHIP & RACKETS
    // ==========================================
    const activeWarTerritories = new Set(
      Object.values(apiWarsMap).map((w) => w.territory),
    );

    for (const tt of apiOwnership) {
      const ttId = tt.id;
      const oldState = dbStates.get(ttId);
      const newFaction = tt.owned_by || null;

      const racket = apiRackets.find((r) => r.name === ttId);
      const isWarring = activeWarTerritories.has(ttId);

      const newState = {
        id: ttId,
        faction_id: newFaction,
        racket_name: racket ? racket.name : null,
        racket_level: racket ? racket.level : null,
        racket_reward:
          racket && racket.reward
            ? `${racket.reward.quantity} ${racket.reward.type}`
            : null,
        is_warring: isWarring,
      };

      let hasChanged = !oldState;

      if (oldState) {
        if (oldState.faction_id !== newState.faction_id) {
          hasChanged = true;
          if (!isWarring) {
            if (oldState.faction_id && !newState.faction_id) {
              dispatchToBot("TERRITORY_EVENT", {
                eventType: "territory_drop",
                data: {
                  territory: ttId,
                  factionId: oldState.faction_id,
                  factionName: "Unknown Faction", // You can pull this from your TornFactions NoSQL cache if you have one
                  war: null,
                  data: null,
                },
              });
            }

            // Check for territory claims
            if (!oldState.faction_id && newState.faction_id) {
              dispatchToBot("TERRITORY_EVENT", {
                eventType: "territory_claim",
                data: {
                  territory: ttId,
                  factionId: newState.faction_id,
                  factionName: "Unknown Faction",
                  war: null,
                  data: null,
                },
              });
            }
            eventsEmitted++;
          }
        }

        if (oldState.racket_level !== newState.racket_level) {
          hasChanged = true;
          dispatchToBot("TERRITORY_EVENT", {
            eventType: "racket_changed",
            data: {
              territory: ttId,
              old: oldState,
              new: newState,
              factionId: null,
              war: null,
            },
          });
          eventsEmitted++;
        }

        if (oldState.is_warring !== newState.is_warring) {
          hasChanged = true;
        }
      }

      if (hasChanged) {
        stateUpserts.push(
          (oldState
            ? { ...oldState, ...newState }
            : newState) as TerritoryStateDocument,
        );
      }
    }

    if (stateUpserts.length > 0) TerritoryStates.insertMany(stateUpserts);
    if (warUpserts.length > 0) WarLedger.insertMany(warUpserts);

    finishLog(
      `States: ${stateUpserts.length} • Wars: ${warUpserts.length} • Emitted: ${eventsEmitted}`,
    );
  } catch (error) {
    logger.error("Failed to execute territory activity engine", error);
    throw error; // Re-throw to ensure the parent scheduler finalizes the state
  }
}

/**
 * Initializes the territory activity engine, calculating the maximum safe cadence
 * based on the number of system keys and attaching it to the event-driven loop.
 */
export function startTerritoryActivitySync(): void {
  // 1 Rackets + 1 Warfare + 9 Ownership = 11 Requests per loop
  const totalRequestsPerLoop = 11;
  const availableKeys = getSystemKeyPool().length;
  const calculatedCadence = calculateOptimalCadence(
    availableKeys,
    totalRequestsPerLoop,
  );

  logger.info(
    `Booting Activity Engine. Keys: ${availableKeys} • Cadence: ${calculatedCadence}s`,
  );

  const existingSchedule = WorkerSchedules.findOne(WORKER_NAME);

  if (existingSchedule) {
    // If the database has an old/different cadence, force the update
    if (existingSchedule.cadence_seconds !== calculatedCadence) {
      existingSchedule.cadence_seconds = calculatedCadence;
      WorkerSchedules.insertOne(existingSchedule);
    }
  } else {
    // Brand new initialization
    WorkerSchedules.insertOne({
      id: WORKER_NAME,
      enabled: true,
      cadence_seconds: calculatedCadence,
      next_run_at: Date.now(),
      last_run_at: null,
      force_run: false,
    });
  }

  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: calculatedCadence,
    handler: async () =>
      await executeSync({
        name: WORKER_NAME,
        timeout: 60000,
        handler: executeActivityEngine,
      }),
  });
}
