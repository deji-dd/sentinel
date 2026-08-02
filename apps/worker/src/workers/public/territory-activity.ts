import { Logger } from "@sentinel/utils";
import { db, type Prisma } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import {
  tornApiManager,
  getSystemKeyPool,
  getSystemKeys,
} from "@sentinel/torn-api-manager";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import { dispatchToBot } from "../../lib/ipc.js";
import {
  ensureFactionsTracked,
  isFactionTrackedFresh,
} from "../../lib/faction-tracker.js";
import type { WorkerStartOptions } from "../registry.js";
import type { IpcWarPayload, IpcTerritoryPayload } from "@sentinel/schemas";

const WORKER_NAME = "torn_territory_activity_sync";
const logger = new Logger(WORKER_NAME);

let dbStatesCache: Map<string, CompactTerritoryState> | null = null;
let dbActiveWarsCache: Map<string, any> | null = null;

export type CompactTerritoryState = {
  id: string;
  factionId: number | null;
  racketChangedAt: number | null;
  racketLevel: number | null;
  isWarring: boolean;
};

type ApiOwnership = TornSchema<"FactionTerritoryOwnership">;
type ApiRacket = TornSchema<"TornRacket"> & { territory?: string };
type ApiFactionRacketsResponse = { rackets?: ApiRacket[] };

type ApiTerritoryWarV1 = {
  territorywars?: Record<
    string,
    {
      territory_war_id: number;
      assaulting_faction: number;
      defending_faction: number;
      started: number;
      score: number;
      required_score: number;
      ended?: number;
    }
  >;
};

/**
 * Calculates safe polling cadence in seconds based on available system API key pool size.
 */
function calculateOptimalCadence(
  keyCount: number,
  requestsPerLoop: number,
): number {
  const maxRequestsPerMinute = Math.max(1, keyCount) * 30;
  const maxLoopsPerMinute = Math.floor(maxRequestsPerMinute / requestsPerLoop);
  return Number((60 / Math.max(1, maxLoopsPerMinute)).toFixed(2));
}

/**
 * Core state reconciliation engine for territory ownership, rackets, and warfare.
 */
async function executeActivityEngine(): Promise<number> {
  const finishLog = logger.time();

  try {
    // Check system initialization state flags from PostgreSQL
    const warInitState = await db.systemState.findUnique({
      where: { id: "war_ledger_init_state" },
    });
    const stateInitState = await db.systemState.findUnique({
      where: { id: "tt_init_state" },
    });

    const isWarsInit = Boolean(warInitState?.init);
    const isStatesInit = Boolean(stateInitState?.init);

    if (!isWarsInit) {
      logger.info(
        "War Ledger not initialized. Clearing table for fresh sync...",
      );
      await db.warLedger.deleteMany({});
      dbActiveWarsCache = null;
    }

    if (!isStatesInit) {
      logger.info(
        "Territory States not initialized. Clearing table for fresh sync...",
      );
      await db.territoryState.deleteMany({});
      dbStatesCache = null;
    }

    const offsets = Array.from({ length: 9 }, (_, i) => i * 500);
    const [key1, key2, ...pageKeys] = await getSystemKeys(2 + offsets.length);

    // Execute parallel fetches across endpoints using key pool
    const [racketsRes, warfareRes, ...ownershipResPages] = await Promise.all([
      tornApiManager.get("/faction/rackets", {
        apiKey: key1.apiKey,
        userId: key1.userId,
      }) as Promise<ApiFactionRacketsResponse>,
      tornApiManager.client.getRaw("/torn", {
        apiKey: key2.apiKey,
        queryParams: { selections: "territorywars" },
      }) as Promise<ApiTerritoryWarV1>,
      ...offsets.map(
        (offset, idx) =>
          tornApiManager.get("/faction/territoryownership", {
            apiKey: pageKeys[idx].apiKey,
            userId: pageKeys[idx].userId,
            queryParams: { limit: 500, offset },
          }) as Promise<TornSchema<"FactionTerritoriesOwnershipResponse">>,
      ),
    ]);

    const apiRackets = racketsRes.rackets || [];
    const apiWarsMap = warfareRes.territorywars || {};

    const apiRacketsMap = new Map<string, ApiRacket>();
    for (let i = 0; i < apiRackets.length; i++) {
      const r = apiRackets[i];
      apiRacketsMap.set(r.territory || r.name, r);
    }

    const apiOwnershipMap = new Map<string, ApiOwnership>();
    const factionIdsToTrack: number[] = [];

    for (let p = 0; p < ownershipResPages.length; p++) {
      const pageList = ownershipResPages[p]?.territoryOwnership;
      if (pageList) {
        for (let i = 0; i < pageList.length; i++) {
          const item = pageList[i];
          apiOwnershipMap.set(item.id, item);

          const facId = item.owned_by;
          if (facId && !isFactionTrackedFresh(facId)) {
            factionIdsToTrack.push(facId);
          }
        }
      }
    }

    for (const w of Object.values(apiWarsMap)) {
      if (
        w.assaulting_faction &&
        !isFactionTrackedFresh(w.assaulting_faction)
      ) {
        factionIdsToTrack.push(w.assaulting_faction);
      }
      if (w.defending_faction && !isFactionTrackedFresh(w.defending_faction)) {
        factionIdsToTrack.push(w.defending_faction);
      }
    }

    if (factionIdsToTrack.length > 0) {
      ensureFactionsTracked(factionIdsToTrack).catch((err) => {
        logger.error("Background faction tracking error:", err);
      });
    }

    // Query active database records if not cached
    if (!dbStatesCache) {
      const dbStatesList = await db.territoryState.findMany();
      dbStatesCache = new Map(
        dbStatesList.map((s) => {
          const racket = s.racket as unknown as ApiRacket | null;
          return [
            s.id,
            {
              id: s.id,
              factionId: s.factionId,
              racketChangedAt: racket?.changed_at ?? null,
              racketLevel: racket?.level ?? null,
              isWarring: s.isWarring,
            },
          ];
        }),
      );
    }
    const dbStates = dbStatesCache;

    if (!dbActiveWarsCache) {
      const dbActiveWarsList = await db.warLedger.findMany({
        where: { endTime: null },
      });
      dbActiveWarsCache = new Map(dbActiveWarsList.map((w) => [w.tt, w]));
    }
    const dbActiveWars = dbActiveWarsCache;

    const warUpserts: IpcWarPayload[] = [];
    const stateUpserts: IpcTerritoryPayload[] = [];

    // ==========================================
    // PHASE 1: WAR RESOLUTION
    // ==========================================
    const activeApiWarIds = new Set(Object.keys(apiWarsMap));
    const now = Date.now();

    // Resolve ENDED Wars
    for (const [tt, dbWar] of dbActiveWars) {
      if (!activeApiWarIds.has(tt)) {
        const currentOwner = apiOwnershipMap.get(tt)?.owned_by;

        const updatedWar: IpcWarPayload = {
          id: dbWar.id,
          tt: dbWar.tt,
          assaultingFaction: dbWar.assaultingFaction,
          defendingFaction: dbWar.defendingFaction,
          victorFaction: currentOwner ?? null,
          startTime: dbWar.startTime,
          endTime: new Date(now),
        };

        warUpserts.push(updatedWar);

        const isTruce =
          now - dbWar.startTime.getTime() < 72 * 3600000 &&
          currentOwner === dbWar.defendingFaction;

        if (isTruce) {
          dispatchToBot({ action: "peace_treaty", data: updatedWar });
        } else if (currentOwner === dbWar.assaultingFaction) {
          if (isWarsInit)
            dispatchToBot({ action: "assault_succeed", data: updatedWar });
        } else {
          if (isWarsInit)
            dispatchToBot({ action: "assault_fail", data: updatedWar });
        }
      }
    }

    // Register NEW Wars
    for (const [tt, war] of Object.entries(apiWarsMap)) {
      if (!dbActiveWars.has(tt)) {
        const data: IpcWarPayload = {
          id: war.territory_war_id.toString(),
          tt,
          assaultingFaction: war.assaulting_faction,
          defendingFaction: war.defending_faction,
          victorFaction: null,
          startTime: new Date(war.started * 1000),
          endTime: null,
        };

        warUpserts.push(data);
        if (isWarsInit) dispatchToBot({ action: "assault_start", data });
      }
    }

    // ==========================================
    // PHASE 2: OWNERSHIP & RACKETS
    // ==========================================
    const activeWarTerritories = new Set(Object.keys(apiWarsMap));

    for (const [ttId, tt] of apiOwnershipMap) {
      const oldState = dbStates.get(ttId);
      const newFaction = tt.owned_by ?? null;
      const racket = apiRacketsMap.get(ttId) ?? null;
      const isWarring = activeWarTerritories.has(ttId);

      const newState: IpcTerritoryPayload = {
        id: ttId,
        factionId: newFaction,
        racket: racket as unknown as Prisma.InputJsonValue | null,
        isWarring,
      };

      let hasChanged = !oldState;

      if (oldState) {
        if (oldState.factionId !== newState.factionId) {
          hasChanged = true;
          if (!isWarring) {
            if (oldState.factionId && isStatesInit) {
              dispatchToBot({
                action: "tt_drop",
                data: {
                  id: oldState.id,
                  factionId: oldState.factionId,
                  racket: null,
                  isWarring: oldState.isWarring,
                },
              });
            }
            if (newState.factionId && isStatesInit) {
              dispatchToBot({ action: "tt_claim", data: newState });
            }
          }
        }

        const oldRacketChangedAt = oldState.racketChangedAt;
        const newRacketChangedAt = racket?.changed_at ?? null;

        if (oldRacketChangedAt !== newRacketChangedAt) {
          hasChanged = true;

          const oldRacketLevel = oldState.racketLevel;
          const newRacketLevel = racket?.level ?? null;

          if (
            oldRacketLevel === null &&
            newRacketLevel !== null &&
            isStatesInit
          ) {
            dispatchToBot({ action: "racket_spawn", data: newState });
          } else if (
            oldRacketLevel !== null &&
            newRacketLevel === null &&
            isStatesInit
          ) {
            dispatchToBot({
              action: "racket_despawn",
              data: {
                id: oldState.id,
                factionId: oldState.factionId,
                racket: null,
                isWarring: oldState.isWarring,
              },
            });
          } else if (oldRacketLevel !== null && newRacketLevel !== null) {
            if (oldRacketLevel > newRacketLevel && isStatesInit) {
              dispatchToBot({ action: "racket_level_down", data: newState });
            } else if (oldRacketLevel < newRacketLevel && isStatesInit) {
              dispatchToBot({ action: "racket_level_up", data: newState });
            }
          }
        }

        if (oldState.isWarring !== newState.isWarring) {
          hasChanged = true;
        }
      }

      if (hasChanged) {
        stateUpserts.push(newState);
      }
    }

    // Persist changes to PostgreSQL using Prisma transactions
    if (stateUpserts.length > 0) {
      const chunkSize = 50;
      for (let i = 0; i < stateUpserts.length; i += chunkSize) {
        const chunk = stateUpserts.slice(i, i + chunkSize);
        await db.$transaction(
          chunk.map((item) =>
            db.territoryState.upsert({
              where: { id: item.id },
              update: {
                factionId: item.factionId,
                racket: item.racket as unknown as Prisma.InputJsonValue,
                isWarring: item.isWarring,
                updatedAt: new Date(),
              },
              create: {
                id: item.id,
                factionId: item.factionId,
                racket: item.racket as unknown as Prisma.InputJsonValue,
                isWarring: item.isWarring,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            }),
          ),
        );
        for (const item of chunk) {
          const itemRacket = item.racket as unknown as ApiRacket | null;
          dbStatesCache!.set(item.id, {
            id: item.id,
            factionId: item.factionId,
            racketChangedAt: itemRacket?.changed_at ?? null,
            racketLevel: itemRacket?.level ?? null,
            isWarring: item.isWarring,
          });
        }
      }
    }

    if (warUpserts.length > 0) {
      const chunkSize = 50;
      for (let i = 0; i < warUpserts.length; i += chunkSize) {
        const chunk = warUpserts.slice(i, i + chunkSize);
        await db.$transaction(
          chunk.map((item) => {
            const startTimeDate =
              item.startTime instanceof Date
                ? item.startTime
                : new Date(item.startTime);
            const endTimeDate = item.endTime
              ? item.endTime instanceof Date
                ? item.endTime
                : new Date(item.endTime)
              : null;

            return db.warLedger.upsert({
              where: { id: item.id },
              update: {
                tt: item.tt,
                assaultingFaction: item.assaultingFaction,
                defendingFaction: item.defendingFaction,
                victorFaction: item.victorFaction,
                startTime: startTimeDate,
                endTime: endTimeDate,
                updatedAt: new Date(),
              },
              create: {
                id: item.id,
                tt: item.tt,
                assaultingFaction: item.assaultingFaction,
                defendingFaction: item.defendingFaction,
                victorFaction: item.victorFaction,
                startTime: startTimeDate,
                endTime: endTimeDate,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            });
          }),
        );
        for (const item of chunk) {
          if (item.endTime) {
            dbActiveWarsCache!.delete(item.tt);
          } else {
            dbActiveWarsCache!.set(item.tt, {
              id: item.id,
              tt: item.tt,
              assaultingFaction: item.assaultingFaction,
              defendingFaction: item.defendingFaction,
              victorFaction: item.victorFaction,
              startTime: item.startTime,
              endTime: item.endTime,
            });
          }
        }
      }
    }

    // Update system initialization flags
    if (!isWarsInit) {
      await db.systemState.upsert({
        where: { id: "war_ledger_init_state" },
        update: { init: true, updatedAt: new Date() },
        create: {
          id: "war_ledger_init_state",
          init: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    if (!isStatesInit) {
      await db.systemState.upsert({
        where: { id: "tt_init_state" },
        update: { init: true, updatedAt: new Date() },
        create: {
          id: "tt_init_state",
          init: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    finishLog();

    if (typeof global.gc === "function") {
      try {
        global.gc();
      } catch {}
    }

    const totalRequestsPerLoop = 11;
    const availableKeys = (await getSystemKeyPool()).length;
    const nextCadence = calculateOptimalCadence(
      availableKeys,
      totalRequestsPerLoop,
    );
    return Date.now() + nextCadence * 1000;
  } catch (error) {
    logger.error("Failed to execute territory activity engine:", error);
    dbStatesCache = null;
    dbActiveWarsCache = null;
    throw error;
  }
}

/**
 * Initializes and boots the territory activity sync worker.
 */
export function startTerritoryActivitySync(options?: WorkerStartOptions): void {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 15,
    initialDelayMs: options?.initialDelayMs,
    handler: executeActivityEngine,
  });
}
