import { TornSchema } from "../../../torn/torn.js";
import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

type SingleProperty = {
  id: number;
  name: string;
  cost: number;
  happy: number;
  upkeep: number;
  modifications: string[];
  staff: string[];
};

export type TornPropertyDocument = BaseDocument & {
  data: SingleProperty;
};

// Automatically creates the `nosql_torn_properties` table if it does not exist
export const TornProperties = new Collection<TornPropertyDocument>(
  sentinelDbEngine,
  "torn_properties",
);
