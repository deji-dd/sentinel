import { executeSync } from "../../lib/sync.js";
import { dispatchToBot } from "../../lib/ipc/index.js";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import {
  TerritoryStates,
  WarLedger,
  WorkerSchedules,
  TornSchema,
  TerritoryStateDocument,
  WarLedgerDocument,
  ApiTerritoryWarV1,
  tornApi,
  getSystemKeyPool,
  Logger,
  ApiRacketResponse,
  SystemState,
  SystemStateDocument,
} from "@sentinel/shared";

const WORKER_NAME = "tt_activity_sync";
const logger = new Logger(WORKER_NAME);

// Global state to ensure the rotation never resets, protecting your rate limits
let keyIndex = 0;

// ==========================================
// TYPE DEFINITIONS
// ==========================================

type ApiOwnership = TornSchema<"FactionTerritoryOwnership">;
type TTInitState = Extract<SystemStateDocument, { init: boolean }>;

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
  const finishLog = logger.time();

  try {
    const keys = getSystemKeyPool();
    const getKey = () => keys[keyIndex++ % keys.length];

    const isWarsInit = SystemState.find<TTInitState>({
      id: "war_ledger_init_state",
    })[0]?.init;
    const isStatesInit = SystemState.find<TTInitState>({
      id: "tt_init_state",
    })[0]?.init;

    if (!isWarsInit) {
      logger.info("War Ledger not initialized. Clearing table...");
      WarLedger.deleteManyBy({});
    }

    if (!isStatesInit) {
      logger.info("Territory States not initialized. Clearing table...");
      TerritoryStates.deleteManyBy({});
    }

    // 9 pages of 500 perfectly covers the ~4,108 limit
    const offsets = Array.from({ length: 9 }, (_, i) => i * 500);

    const [racketsRes, warfareRes, ...ownershipResPages] = await Promise.all([
      tornApi.get("/faction/rackets", {
        apiKey: getKey(),
      }) as Promise<ApiRacketResponse>,
      // Switching to V1 global endpoint to bypass pagination limits
      tornApi.getRaw("/torn", getKey(), {
        selections: "territorywars",
      }) as Promise<ApiTerritoryWarV1>,
      ...offsets.map(
        (offset) =>
          tornApi.get("/faction/territoryownership", {
            apiKey: getKey(),
            queryParams: { limit: 500, offset },
          }) as Promise<TornSchema<"FactionTerritoriesOwnershipResponse">>,
      ),
    ]);

    // Normalize Data based on v2 typings and explicitly cast to our strict interfaces
    const apiRackets = racketsRes.rackets;
    const apiOwnership = ownershipResPages.flatMap(
      (page) => page.territoryOwnership,
    );

    const apiWarsMap = warfareRes.territorywars;
    // Maps for O(1) lookups to avoid O(N^2) bottlenecks
    const apiRacketsMap = new Map<string, ApiRacketResponse["rackets"][number]>(
      apiRackets.map((r) => [r.territory, r]),
    );
    const apiOwnershipMap = new Map<string, ApiOwnership>(
      apiOwnership.map((o) => [o.id, o]),
    );

    const dbStates = new Map(TerritoryStates.findAll().map((s) => [s.id, s]));
    const dbActiveWars = new Map(
      WarLedger.findAll((w) => w.end_time === null).map((w) => [w.id, w]),
    );

    const stateUpserts: TerritoryStateDocument[] = [];
    const warUpserts: WarLedgerDocument[] = [];

    // ==========================================
    // PHASE 1: WAR RESOLUTION
    // ==========================================
    const activeApiWarIds = new Set(Object.keys(apiWarsMap));

    // Resolve ENDED Wars
    for (const [tt, dbWar] of dbActiveWars) {
      if (!activeApiWarIds.has(tt)) {
        const currentOwner = apiOwnershipMap.get(tt)?.owned_by;

        dbWar.id = tt; // Ensure it has the correct property name for dispatch
        dbWar.end_time = Date.now();

        if (currentOwner) {
          dbWar.victor_faction = currentOwner;
          warUpserts.push(dbWar);
        }

        const isTruce =
          Date.now() - dbWar.start_time < 72 * 3600000 &&
          currentOwner === dbWar.defending_faction;

        if (isTruce) {
          dispatchToBot({ action: "peace_treaty", data: dbWar });
        } else {
          if (currentOwner === dbWar.assaulting_faction) {
            if (isWarsInit)
              dispatchToBot({ action: "assault_succeed", data: dbWar });
          } else {
            if (isWarsInit)
              dispatchToBot({ action: "assault_fail", data: dbWar });
          }
        }
        warUpserts.push(dbWar);
      }
    }

    // Register NEW Wars
    for (const [tt, war] of Object.entries(apiWarsMap)) {
      if (!dbActiveWars.has(tt)) {
        const data = {
          id: tt,
          assaulting_faction: war.assaulting_faction,
          defending_faction: war.defending_faction,
          victor_faction: null,
          start_time: war.started * 1000,
          end_time: null,
        };

        warUpserts.push(data);

        if (isWarsInit) dispatchToBot({ action: "assault_start", data });
      }
    }

    // ==========================================
    // PHASE 2: OWNERSHIP & RACKETS
    // ==========================================
    const activeWarTerritories = new Set(Object.keys(apiWarsMap));

    for (const tt of apiOwnership) {
      const ttId = tt.id;
      const oldState = dbStates.get(ttId);
      const newFaction = tt.owned_by;

      const racket = apiRacketsMap.get(ttId);
      const isWarring = activeWarTerritories.has(ttId);

      const newState = {
        id: ttId,
        faction_id: newFaction,
        racket: racket ?? null,
        is_warring: isWarring,
      };

      let hasChanged = !oldState;

      if (oldState) {
        if (oldState.faction_id !== newState.faction_id) {
          hasChanged = true;
          if (!isWarring) {
            // If it was owned before, they lost/dropped it
            if (oldState.faction_id) {
              if (isStatesInit)
                dispatchToBot({
                  action: "tt_drop",
                  data: oldState,
                });
            }

            // If it is owned now, they claimed it
            if (newState.faction_id) {
              if (isStatesInit)
                dispatchToBot({
                  action: "tt_claim",
                  data: newState,
                });
            }
          }
        }

        if (oldState.racket?.changed_at !== newState.racket?.changed_at) {
          hasChanged = true;

          // racket spawn
          if (!oldState.racket && newState.racket) {
            if (isStatesInit)
              dispatchToBot({ action: "racket_spawn", data: newState });
          }

          // racket despawn
          else if (oldState.racket && !newState.racket) {
            if (isStatesInit)
              dispatchToBot({ action: "racket_despawn", data: oldState });
          } else if (oldState.racket && newState.racket) {
            // racket level down
            if (oldState.racket.level > newState.racket.level) {
              if (isStatesInit)
                dispatchToBot({ action: "racket_level_down", data: newState });
            }

            // racket level up
            else if (oldState.racket.level < newState.racket.level) {
              if (isStatesInit)
                dispatchToBot({ action: "racket_level_up", data: newState });
            }
          }
        }

        if (oldState.is_warring !== newState.is_warring) {
          hasChanged = true;
        }
      }

      if (hasChanged) {
        stateUpserts.push(oldState ? { ...oldState, ...newState } : newState);
      }
    }

    if (stateUpserts.length > 0) TerritoryStates.insertMany(stateUpserts);
    if (warUpserts.length > 0) WarLedger.insertMany(warUpserts);

    if (!isWarsInit) {
      SystemState.update({ id: "war_ledger_init_state", init: true });
    }
    if (!isStatesInit) {
      SystemState.update({ id: "tt_init_state", init: true });
    }

    finishLog();
  } catch (error) {
    logger.error("Failed to execute territory activity engine", error);
    throw error;
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
