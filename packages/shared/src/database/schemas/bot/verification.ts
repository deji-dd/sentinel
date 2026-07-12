import { BaseDocument, Collection } from "@sentinel/shared";
import { sentinelDbEngine } from "../../engine.js"; // Your DB Engine

export type GuildConfigDocument = BaseDocument & {
  guild_id: string;
  auto_verify: boolean;
  nickname_template: string;
  verified_role_id: string | null;
  verified_role_ids: string[];
  enabled_modules: string[];
  admin_role_ids: string[];
  log_channel_id: string | null;
  faction_list_channel_id: string | null;
  faction_list_message_ids: string[];
  tt_full_channel_id: string | null;
  tt_filtered_channel_id: string | null;
  tt_territory_ids: string[];
  tt_faction_ids: number[];
};

export type FactionRoleMappingDocument = BaseDocument & {
  guild_id: string;
  faction_id: number;
  faction_name: string | null;
  member_role_ids: string[];
  leader_role_ids: string[];
  enabled: boolean;
};

export type GuildApiKeyDocument = BaseDocument & {
  guild_id: string;
  user_id: number;
  api_key_encrypted: string;
  is_primary: boolean;
  provided_by: string;
};

export type ReactionRoleMessageDocument = BaseDocument & {
  guild_id: string;
  message_id: string;
  required_role_id: string | null;
  sync_roles: boolean;
  channel_id: string;
  title: string;
  description: string;
};

export type ReactionRoleMappingDocument = BaseDocument & {
  message_id: string;
  role_id: string;
  emoji: string;
};

export type MercenaryRegisteredMercDocument = BaseDocument & {
  guild_id: string;
  discord_id: string;
  api_key: string | null;
  torn_id: number;
  torn_name: string;
  is_active: boolean;
  updated_at: string;
};

export type MercenaryConfigDocument = BaseDocument & {
  guild_id: string;
  merc_role_ids: string[];
};

export type VerifiedUserDocument = BaseDocument & {
  discord_id: string;
  torn_id: number;
  torn_name: string;
  faction_id: number | null;
  faction_tag: string | null;
  updated_at: string;
};

export type VerificationRequest = {
  guild_id: string;
  channel_id: string;
  discord_id: string;
  current_role_ids: string[];
  current_nickname: string | null;
};

export type VerificationSuccessResponse = {
  guild_id: string;
  channel_id: string;
  discord_id: string;
  roles_to_add: string[] | null;
  roles_to_remove: string[] | null;
  new_nickname: string | null;
};

export type VerificationFailureResponse = {
  guild_id: string;
  channel_id: string;
  discord_id: string;
  error: { message: string };
};

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
