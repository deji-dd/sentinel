/**
 * Discord Guild Management API Schemas
 */
import { GuildConfigDocument, SystemModuleDocument } from "../../database/index.js";

export type SystemModulesListResponse = SystemModuleDocument[];

export interface MaskedGuildApiKey {
  id: string;
  masked: string;
  is_primary: boolean;
  provided_by?: string;
}

export interface GuildConfigResponse {
  initialized: boolean;
  config?: GuildConfigDocument;
  hasApiKey?: boolean;
  apiKeys?: MaskedGuildApiKey[];
}

export interface UpdateGuildConfigPayload extends Partial<GuildConfigDocument> {
  api_key?: string;
}

export interface TerritoryBlueprintSummary {
  id: string;
  sector: number;
  size: number;
  slots: number;
  respect: number;
}

export type TerritoryListResponse = TerritoryBlueprintSummary[];

// ─── Reaction Roles ───────────────────────────────────────────────────────────

import { ReactionRoleMessageDocument, ReactionRoleMappingDocument } from "../../database/index.js";

export interface ReactionRoleMessageWithMappings extends ReactionRoleMessageDocument {
  /** All emoji → role mappings attached to this message. */
  emojis: ReactionRoleMappingDocument[];
}

export type ReactionRoleMessagesListResponse = ReactionRoleMessageWithMappings[];

export interface CreateReactionRoleMessagePayload {
  title: string;
  channel_id: string;
  required_role_id?: string | null;
}

export interface UpdateReactionRoleMessagePayload {
  title?: string;
  channel_id?: string;
  required_role_id?: string | null;
}

export interface AddEmojiMappingPayload {
  emoji: string;
  role_id: string;
}

