import { BaseDocument, Collection } from "@sentinel/shared";
import { sentinelDbEngine } from "../../engine.js"; // Your DB Engine

export interface GuildConfigDocument extends BaseDocument {
  guild_id: string;
  auto_verify: boolean;
  nickname_template: string;
  verified_role_id: string | null;
  verified_role_ids: string[];
  sync_interval_seconds: number;
  enabled_modules: string[];
  admin_role_ids: string[];
  log_channel_id: string | null;
  faction_list_channel_id: string | null;
  faction_list_message_ids: string[];
  tt_full_channel_id: string | null;
  tt_filtered_channel_id: string | null;
  tt_territory_ids: string[];
  tt_faction_ids: string[];
}

export interface FactionRoleMappingDocument extends BaseDocument {
  guild_id: string;
  faction_id: number;
  faction_name: string | null;
  member_role_ids: string[];
  leader_role_ids: string[];
  enabled: boolean;
}

export interface GuildApiKeyDocument extends BaseDocument {
  guild_id: string;
  user_id: number;
  api_key_encrypted: string;
  is_primary: boolean;
}

export interface ReactionRoleMessageDocument extends BaseDocument {
  guild_id: string;
  message_id: string;
  required_role_id: string | null;
  sync_roles: boolean;
}

export interface ReactionRoleMappingDocument extends BaseDocument {
  message_id: string;
  role_id: string;
  emoji: string;
}

export interface MercenaryRegisteredMercDocument extends BaseDocument {
  guild_id: string;
  discord_id: string;
  api_key: string | null;
  torn_id: number;
  torn_name: string;
  is_active: boolean;
  updated_at: string;
}

export interface MercenaryConfigDocument extends BaseDocument {
  guild_id: string;
  merc_role_ids: string[];
}

export interface VerifiedUserDocument extends BaseDocument {
  discord_id: string;
  torn_id: number;
  torn_name: string;
  faction_id: number | null;
  faction_tag: string | null;
  updated_at: string;
}

export interface VerificationTargetState {
  guildId: string;
  discordId: string;
  targetNickname: string;
  managedRoleIds: string[]; // The strict boundary of roles the Bot can touch
  targetRoleIds: string[]; // The roles the user actually qualifies for
  isNewUser: boolean;
  isUpdate: boolean;
  status: "success" | "not_linked" | "error";
  errorMessage?: string;
  logData?: {
    tornId: number;
    tornName: string;
    factionName: string | null;
  };
}
export interface VerificationJobDocument extends BaseDocument {
  guild_id: string;
  discord_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  module: "auto_verify" | "manual_sync";
  payload: {
    nickname_template?: string;
    verified_role_ids?: string[];
  };
  error_message?: string;
  created_at: number; // CHANGED: Must be Unix Epoch ms for the DB pruner to work
}

// Instantiate the collections
export const GuildConfigs = new Collection<GuildConfigDocument>(
  sentinelDbEngine,
  "guild_config",
);
export const FactionRoles = new Collection<FactionRoleMappingDocument>(
  sentinelDbEngine,
  "faction_roles",
);
export const GuildApiKeys = new Collection<GuildApiKeyDocument>(
  sentinelDbEngine,
  "guild_api_keys",
);
export const ReactionRoleMessages = new Collection<ReactionRoleMessageDocument>(
  sentinelDbEngine,
  "reaction_role_messages",
);
export const ReactionRoleMappings = new Collection<ReactionRoleMappingDocument>(
  sentinelDbEngine,
  "reaction_role_mappings",
);
export const MercenaryRegisteredMercs =
  new Collection<MercenaryRegisteredMercDocument>(
    sentinelDbEngine,
    "mercenary_registered_mercs",
  );
export const MercenaryConfigs = new Collection<MercenaryConfigDocument>(
  sentinelDbEngine,
  "mercenary_config",
);
export const VerifiedUsers = new Collection<VerifiedUserDocument>(
  sentinelDbEngine,
  "verified_users",
);
export const VerificationJobs = new Collection<VerificationJobDocument>(
  sentinelDbEngine,
  "verification_jobs",
);
