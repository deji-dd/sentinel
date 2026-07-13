import { TornSchema } from "../../../torn/torn.js";
import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type UserStateDocument = BaseDocument &
  ({
    id: "bars";
  } & TornSchema<"UserBarsResponse">);

// Automatically creates the `nosql_system_state` table if it does not exist
export const UserState = new Collection<UserStateDocument>(
  sentinelDbEngine,
  "user_state",
);
