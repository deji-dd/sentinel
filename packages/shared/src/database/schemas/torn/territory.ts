import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";
import type { TornSchema } from "../../../torn/torn.js";

// 1. Static Blueprint (Daily Sync)
export type TerritoryBlueprintDocument = BaseDocument & {
  // id is the territory name (e.g., 'JCA')
  data: TornSchema<"TornTerritory">;
};
export const TerritoryBlueprints = new Collection<TerritoryBlueprintDocument>(
  sentinelDbEngine,
  "territory_blueprints",
);

// 2. Dynamic State (15s Sync)
export type TerritoryStateDocument = BaseDocument & {
  // id is the territory name (e.g., 'JCA')
  faction_id: number | null;
  racket: ApiRacketResponse["rackets"][number] | null;
  is_warring: boolean;
};
export const TerritoryStates = new Collection<TerritoryStateDocument>(
  sentinelDbEngine,
  "territory_states",
  [{ key: "faction_id", type: "INTEGER" }],
);

// 3. Historical War Ledger (15s Sync)
export type WarLedgerDocument = BaseDocument & {
  // id is the tt name
  tt: string;
  assaulting_faction: number;
  defending_faction: number;
  victor_faction: number | null;
  start_time: number;
  end_time: number | null;
};
export const WarLedger = new Collection<WarLedgerDocument>(
  sentinelDbEngine,
  "war_ledger",
  [
    { key: "territory_id", type: "TEXT" },
    { key: "assaulting_faction", type: "INTEGER" },
    { key: "defending_faction", type: "INTEGER" },
  ],
);

// 4. Racket Tenures (Used to calculate "$50M earned over 5 days")
export type RacketTenureDocument = BaseDocument & {
  territory_id: string;
  faction_id: number;
  racket_name: string;
  reward: string;
  started_at: number; // epoch ms
  ended_at: number | null; // epoch ms (null = currently active)
};
export const RacketTenures = new Collection<RacketTenureDocument>(
  sentinelDbEngine,
  "racket_tenures",
  [
    { key: "territory_id", type: "TEXT" },
    { key: "faction_id", type: "INTEGER" },
  ],
);

export type ApiTerritoryWarV1 = {
  territorywars: Record<
    string,
    {
      territory_war_id: number;
      assaulting_faction: number;
      defending_faction: number;
      score: number;
      required_score: number;
      started: number;
      ends: number;
    }
  >;
};

export type ApiRacketResponse = {
  rackets: (TornSchema<"TornRacket"> & {
    territory: string;
    faction_id: string;
  })[];
};
