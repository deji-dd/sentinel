import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type UserConfigDocument = BaseDocument & {
  id: "global";
  api_key: string;
  updated_at: number;
  log_manager_enabled?: boolean;
  log_manager_cadence?: number;
  crimes_module_enabled?: boolean;
  gym_module_enabled?: boolean;
  stocks_module_enabled?: boolean;
};

// Automatically creates the `nosql_user_config` table if it does not exist
export const UserConfig = new Collection<UserConfigDocument>(
  sentinelDbEngine,
  "user_config",
);
