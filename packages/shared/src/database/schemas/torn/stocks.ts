import { Collection, BaseDocument } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type TornStockDocument = BaseDocument & {
  name: string;
  acronym: string;
  images: {
    logo: string;
    full: string;
  };
  market: {
    price: number;
    cap: number;
    shares: number;
    investors: number;
  };
  bonus: {
    passive: boolean;
    frequency: number;
    requirement: number;
    description: string;
  };
};

export const TornStocks = new Collection<TornStockDocument>(
  sentinelDbEngine,
  "torn_stocks"
);
