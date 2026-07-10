import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";
import type { TornSchema } from "../../../torn/torn.js";

// 1. Static Blueprint (Daily Sync)
export interface TerritoryBlueprintDocument extends BaseDocument {
  // id is the territory name (e.g., 'JCA')
  data: TornSchema<"TornTerritoriesResponse">["territory"][number];
}
export const TerritoryBlueprints = new Collection<TerritoryBlueprintDocument>(
  sentinelDbEngine,
  "territory_blueprints",
);

// 2. Dynamic State (15s Sync)
export interface TerritoryStateDocument extends BaseDocument {
  // id is the territory name (e.g., 'JCA')
  faction_id: number | null;
  racket_name: string | null;
  racket_level: number | null;
  racket_reward: string | null;
  is_warring: boolean;
}
export const TerritoryStates = new Collection<TerritoryStateDocument>(
  sentinelDbEngine,
  "territory_states",
);

// 3. Historical War Ledger (15s Sync)
export interface WarLedgerDocument extends BaseDocument {
  // id is the war_id from Torn as a string
  territory_id: string;
  assaulting_faction: number;
  defending_faction: number;
  victor_faction: number | null;
  start_time: number; // epoch ms
  end_time: number | null; // epoch ms (null = active war)
}
export const WarLedger = new Collection<WarLedgerDocument>(
  sentinelDbEngine,
  "war_ledger",
);

// 4. Racket Tenures (Used to calculate "$50M earned over 5 days")
export interface RacketTenureDocument extends BaseDocument {
  territory_id: string;
  faction_id: number;
  racket_name: string;
  reward: string;
  started_at: number; // epoch ms
  ended_at: number | null; // epoch ms (null = currently active)
}
export const RacketTenures = new Collection<RacketTenureDocument>(
  sentinelDbEngine,
  "racket_tenures",
);
