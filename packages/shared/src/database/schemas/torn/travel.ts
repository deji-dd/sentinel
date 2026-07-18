import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type TravelDestinationDocument = BaseDocument & {
  id: string; // Country code (e.g., 'mex')
  updatedAt: number;
  stocks: Array<{
    id: number;
    name: string;
    quantity: number;
    cost: number;
    history: Array<{ timestamp: number; quantity: number }>;
  }>;
};

export const TravelDestinations = new Collection<TravelDestinationDocument>(
  sentinelDbEngine,
  "torn_travel_destinations",
  [{ key: "updatedAt", type: "INTEGER" }]
);
