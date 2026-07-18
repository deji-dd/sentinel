import { Collection, BaseDocument } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type StockLedgerDocument = BaseDocument & {
  timestamp: number;
  stock_id: number;
  value: number; // For ROI calculation (e.g. market price of item received, or cash received)
  log_type: number; // 5530-5537
  amount_received?: number;
  item_id?: number;
};

export const StockLedger = new Collection<StockLedgerDocument>(
  sentinelDbEngine,
  "stock_ledger",
  [
    { key: "timestamp", type: "INTEGER" },
    { key: "stock_id", type: "INTEGER" }
  ]
);
