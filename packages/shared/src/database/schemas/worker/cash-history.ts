import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type CashHistoryDocument = BaseDocument & {
  // id: Timestamp of the start of the day (00:00 UTC) in seconds
  timestamp: number;
  liquid_cash: number;
};

export const CashHistory = new Collection<CashHistoryDocument>(
  sentinelDbEngine,
  "cash_history",
  [{ key: "timestamp", type: "INTEGER" }],
);
