import { BaseDocument, Collection } from "../collection.js";
import { sentinelDbEngine } from "../engine.js";

export interface SystemStateDocument extends BaseDocument {
  id: string; // 'api', 'worker', 'bot'
  cpu?: number;
  memory?: number; // in MB
  last_updated: number; // Unix timestamp
  status?: "online" | "offline" | "connected";
  liquid_cash?: number;
}

// Automatically creates the `nosql_system_state` table if it does not exist
export const SystemState = new Collection<SystemStateDocument>(
  sentinelDbEngine,
  "system_state",
);
