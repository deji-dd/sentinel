import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";
import type { TornSchema } from "../../../torn/torn.js";

// Extracts the precise nested faction structure from the OpenAPI spec
type FactionBasicData = TornSchema<"FactionBasic">;

export interface TornFactionDocument extends BaseDocument {
  // id is the stringified Torn Faction ID (e.g. "13784")
  data: FactionBasicData;
  updated_at: number; // Unix Epoch ms
}

export const TornFactions = new Collection<TornFactionDocument>(
  sentinelDbEngine,
  "torn_factions",
);
