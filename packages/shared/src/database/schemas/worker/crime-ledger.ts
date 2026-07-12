import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type CrimeLedgerDocument = BaseDocument & {
  crime_name: string;
  nerve_spent: number;
  total_cash_value: number; // Value of items + cash
  is_baseline: boolean;
  timestamp: number;
};

export const CrimeLedger = new Collection<CrimeLedgerDocument>(
  sentinelDbEngine,
  "crime_ledger",
  [
    { key: "crime_name", type: "TEXT" },
    { key: "timestamp", type: "INTEGER" },
  ],
);
