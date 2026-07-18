import { Collection, BaseDocument } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type UserStockTransaction = {
  id: number;
  shares: number;
  price: number;
  timestamp: number;
};

export type UserStockDocument = BaseDocument & {
  shares: number;
  transactions: UserStockTransaction[];
  bonus: {
    available: boolean;
    increment: number;
    progress: number;
    frequency: number;
  };
};

export const UserStocks = new Collection<UserStockDocument>(
  sentinelDbEngine,
  "user_stocks"
);
