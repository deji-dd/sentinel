import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type BazaarMugConfigDocument = BaseDocument & {
  // id is typically the guild_id
  guild_id: string;
  is_enabled: number; // 1 or 0
  dashboard_message_id: string | null;
  min_bazaar_drop_threshold: number;
  min_offline_time_minutes: number;
  notification_channel_id: string | null;
  ping_role_id: string | null;
  target_player_ids_json: string; // Legacy array string
  created_at: string;
  updated_at: string;
};

export type BazaarMugTargetDocument = BaseDocument & {
  guild_id: string;
  player_id: string;
  player_name: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export const BazaarMugConfigs = new Collection<BazaarMugConfigDocument>(
  sentinelDbEngine,
  "bazaar_mug_config",
);
export const BazaarMugTargets = new Collection<BazaarMugTargetDocument>(
  sentinelDbEngine,
  "bazaar_mug_targets",
);
