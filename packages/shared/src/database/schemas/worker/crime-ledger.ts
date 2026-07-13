import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type CrimeLedgerDocument = BaseDocument & {
  crime_name: string;
  nerve_spent: number;
  total_value: number; // Value of items + cash
};

export const CrimeLedger = new Collection<CrimeLedgerDocument>(
  sentinelDbEngine,
  "crime_ledger",
);
