import { StockLedgerDocument, TornStockDocument, UserStockDocument } from "../../database/index.js";
import { LogBackfillProgressPayload } from "./status.js";

export interface StocksHistoryResponse {
  initializing: boolean;
  initTimestamp?: number;
  data: StockLedgerDocument[];
}

export interface EnhancedTornStock extends TornStockDocument {
  calculated_apr: number;
  calculated_dividend_value: number;
  dividend_type: string;
}

export interface StocksStateData {
  torn_stocks: EnhancedTornStock[];
  user_stocks: UserStockDocument[];
}

export interface StocksStateResponse {
  data: StocksStateData;
}
