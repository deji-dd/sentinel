import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type StatType = "strength" | "defense" | "speed" | "dexterity";

export type GymLedgerDocument = BaseDocument & {
  timestamp: number;
  stat_type: StatType;
  trains: number;
  energy_used: number;
  stat_gained: number;
};

export const GymLedger = new Collection<GymLedgerDocument>(
  sentinelDbEngine,
  "gym_ledger",
  [
    { key: "timestamp", type: "INTEGER" },
    { key: "stat_type", type: "TEXT" }
  ]
);
