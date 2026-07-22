import { LedgerEventDocument } from "../../database/index.js";

export interface WealthHistoricalPoint {
  timestamp: number;
  netWorth: number;
  dailyYield: number;
  liquidCash: number;
}

export interface WealthActionItem {
  id: string;
  type: string;
  description: string;
  timestamp: number;
}

export interface WealthTransactionItem {
  id: string;
  category: string;
  description: string;
  amount: number;
  cashFlow: number;
  timestamp: number;
}

export interface WealthStateData {
  liquidCash: number;
  dailyYield: number;
  recentTransactions: WealthTransactionItem[];
  historical: WealthHistoricalPoint[];
  actionQueue: WealthActionItem[];
}

export interface WealthStateResponse {
  data?: WealthStateData;
  initializing?: boolean;
}
