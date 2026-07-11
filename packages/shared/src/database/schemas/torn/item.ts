import { TornSchema } from "../../../torn/torn.js";
import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

type SingleTornItem = TornSchema<"TornItem">;

export interface TornItemDocument extends BaseDocument {
  /** * The unmodified JSON object from the Torn API.
   * Completely isolated from the NoSQL BaseDocument to prevent 'id' collisions.
   */
  data: SingleTornItem & { item_id?: number };
}

// Automatically creates the `nosql_torn_items` table if it does not exist
export const TornItems = new Collection<TornItemDocument>(
  sentinelDbEngine,
  "torn_items",
  [
    { key: "item_id", type: "INTEGER" }
  ]
);
