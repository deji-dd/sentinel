import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type UserConfigDocument = BaseDocument & {
  id: "global";
  api_key: string;
  updated_at: number;
  log_manager_cadence?: number;
  travel_capacity?: number;
  travel_method?: string;
};

// Automatically creates the `nosql_user_config` table if it does not exist
export const UserConfig = new Collection<UserConfigDocument>(
  sentinelDbEngine,
  "user_config",
);
