import { TornSchema } from "../../../torn/torn.js";
import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

type SingleTornItem = TornSchema<"TornItem">;

export type TornItemDocument = BaseDocument & {
  data: SingleTornItem;
};

// Automatically creates the `nosql_torn_items` table if it does not exist
export const TornItems = new Collection<TornItemDocument>(
  sentinelDbEngine,
  "torn_items",
);
