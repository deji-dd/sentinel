import { Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

// Travel Area Mapping
export interface TravelAreaMapDocument {
  id: string; // Area ID
  yataCode: string;
}

export const TravelAreaMap = new Collection<TravelAreaMapDocument>(
  sentinelDbEngine,
  "travel_area_map",
);

// Unmapped Travel Areas
export interface TravelUnmappedAreaDocument {
  id: string; // Area ID
  first_seen: number;
}

export const TravelUnmappedAreas = new Collection<TravelUnmappedAreaDocument>(
  sentinelDbEngine,
  "travel_unmapped_areas",
);

// Travel Ledger for Profit Tracking
export interface TravelLedgerDocument {
  id: string; // Area ID
  tracked_profit: number;
}

export const TravelLedger = new Collection<TravelLedgerDocument>(
  sentinelDbEngine,
  "travel_ledger",
);

// Seed default for Torn
if (!TravelAreaMap.findOne("1")) {
  TravelAreaMap.insertOne({ id: "1", yataCode: "torn" });
}
