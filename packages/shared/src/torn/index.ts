import rawLogCategories from "./logcategories.json";
import rawLogTypes from "./logtypes.json";
export * from "./api-key-manager.js";
export * from "./torn.js";
export * from "./api-key-cooldown.js";
export * from "./client.js";
export * from "./faction.js";
// 1. Export as strictly typed Arrays
export const TornLogCategories: Array<{ id: number; title: string }> =
  rawLogCategories;

// Assuming logtypes still has the { "logtypes": [...] } wrapper from the script
export const TornLogTypes: Array<{ id: number; title: string }> =
  rawLogTypes.logtypes;

// 2. Export pre-computed O(1) Maps for instant background processing
export const TornLogCategoryMap = new Map(
  rawLogCategories.map((cat) => [cat.id, cat.title]),
);

export const TornLogTypeMap = new Map(
  rawLogTypes.logtypes.map((log) => [log.id, log.title]),
);
