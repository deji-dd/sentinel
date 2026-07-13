import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type AssetCategory =
  | "item"
  | "point"
  | "equity"
  | "property"
  | "company";
export type AssetLocation =
  | "inventory"
  | "bazaar"
  | "display"
  | "equipped"
  | "escrow"
  | "armory"
  | "portfolio"
  | "property";

export type AssetDocument = BaseDocument & {
  // id: For fungible items: `item_${id}`, points: `points`, equities: `equity_${ticker}`
  // id: For non-fungible items: `uid_${uid}`
  type: AssetCategory;
  asset_id: string | number; // The Torn item ID, stock ticker, or "points"
  quantity: number;
  moving_average_cost: number; // Cost Basis per unit (in fiat/dollars)
  total_cost_basis: number; // Total Cost Basis (quantity * moving_average_cost)
  realized_pnl: number; // Running total of all realized profit/loss
  location: AssetLocation;
  owner: "personal" | "faction";
  origin: string; // e.g. "legacy_init", "purchase", "trade", "crime"
  last_updated: number;
};

export type LedgerEventType =
  | "purchase"
  | "sale"
  | "storage_transfer"
  | "injection"
  | "income"
  | "sink"
  | "barter"
  | "loss"
  | "init";

export type LedgerEventDocument = BaseDocument & {
  // id: log_id or custom ID for initialization
  log_id: string; // Associated Torn log ID, if applicable
  timestamp: number;
  type: LedgerEventType;
  category_id: number; // The context.xml category (1-9)
  transaction_name: string; // e.g. "Asset Purchase", "Fiat Generation"

  assets_affected:
    | {
        asset_id: string | number;
        quantity_change: number; // Negative for loss/sale, positive for gain/purchase
        cost_basis_impact: number; // How much the cost basis changed for this specific movement
      }[]
    | null;

  cash_flow: number; // Positive for cash gained, negative for cash spent
  realized_pnl: number; // 0 if no PnL event, else the Realized Profit or Loss
  status?: "pending_review" | "resolved"; // For Action Queue tracking

  raw_log: any; // The raw parsed log object or event details
};

export const Assets = new Collection<AssetDocument>(
  sentinelDbEngine,
  "assets",
  [
    { key: "asset_id", type: "TEXT" },
    { key: "owner", type: "TEXT" },
    { key: "location", type: "TEXT" },
  ],
);
export const LedgerEvents = new Collection<LedgerEventDocument>(
  sentinelDbEngine,
  "ledger_events",
  [
    { key: "type", type: "TEXT" },
    { key: "timestamp", type: "INTEGER" },
    { key: "status", type: "TEXT" },
    { key: "log_id", type: "TEXT" },
  ],
);
