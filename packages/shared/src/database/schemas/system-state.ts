import { BaseDocument, Collection } from "../collection.js";
import { sentinelDbEngine } from "../engine.js";

type InitState =
  | {
      id:
        | "war_ledger_init_state"
        | "tt_init_state"
        | "crimes_init_state"
        | "items_init_state";
      init: boolean;
    }
  | {
      id: "crimes_ledger_init_state" | "items_ledger_init_state" | "gym_ledger_init_state";
      init: boolean;
      timestamp: number;
    }
  | {
      id: "gym_ledger_backfill_progress";
      timestamp: number;
      status: "in_progress" | "completed" | "error";
      logs_parsed?: number;
      oldest_timestamp_reached?: number | null;
      error?: string;
      active_chunks?: { logSelection: string; currentTo: number | undefined }[] | null;
    }
  | {
      id: "log_manager_last_checked";
      timestamp: number;
    };

// type UserState = {
//   id: "user_state";
//   liquid_cash: number;
// };

export type SystemStateDocument = BaseDocument &
  (
    | InitState
    | {
        id: "api" | "worker" | "bot";
        cpu?: number;
        memory?: number; // in MB
        last_updated: number; // Unix timestamp
        status?: "online" | "offline" | "connected";
      }
    | {
        id: "api_boot_alert" | "worker_boot_alert" | "bot_boot_alert";
        component: "api" | "worker" | "bot";
        message: string;
        timestamp: number;
        reported: boolean;
      }
  );

// Automatically creates the `nosql_system_state` table if it does not exist
export const SystemState = new Collection<SystemStateDocument>(
  sentinelDbEngine,
  "system_state",
);
