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

export type CrimeLogDocument = BaseDocument & {
  crime_id: number;
  action: string;
  nerve: number;
  value: number;
  timestamp: number;
};

export const CrimeLogs = new Collection<CrimeLogDocument>(
  sentinelDbEngine,
  "crime_logs",
);

export type CrimeActionMappingDocument = BaseDocument & {
  action: string;
  crime_id: number;
};

export const CrimeActionMappings = new Collection<CrimeActionMappingDocument>(
  sentinelDbEngine,
  "crime_action_mappings",
);
