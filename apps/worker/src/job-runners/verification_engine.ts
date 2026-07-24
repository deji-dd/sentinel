import {
  Logger,
  TornError,
  VerificationFailureResponse,
  VerificationRequest,
  VerificationSuccessResponse,
} from "@sentinel/shared";
import {
  GuildConfigs,
  FactionRoles,
  GuildApiKeys,
  MercenaryConfigs,
  MercenaryRegisteredMercs,
  ReactionRoleMessages,
  ReactionRoleMappings,
  VerifiedUsers,
  getNextApiKey,
  decryptApiKey,
  type TornSchema,

  // Explicitly importing all document types to fix the implicit 'any' errors
  type VerifiedUserDocument,
  type GuildConfigDocument,
  type GuildApiKeyDocument,
  type FactionRoleMappingDocument,
  type MercenaryConfigDocument,
  type ReactionRoleMessageDocument,
  type ReactionRoleMappingDocument,
} from "@sentinel/shared";
import { tornApi } from "@sentinel/shared";

const logger = new Logger("verification_job");

type UserGenericResponse = TornSchema<"UserDiscordResponse"> &
  TornSchema<"UserFactionResponse"> &
  TornSchema<"UserProfileResponse">;

/**
 * Shared Cache interface to pass to the engine if running a bulk guild loop.
 * This prevents calling /faction/{id}/members 500 times for the same faction.
 */
export interface VerificationCache {
  factionLeaders: Map<number, Set<number>>;
  factionMembers: Map<number, Set<number>>;
  // Guild configurations
  config?: GuildConfigDocument;
  apiKeys?: GuildApiKeyDocument[];
  factionMappings?: FactionRoleMappingDocument[];
  mercConfig?: MercenaryConfigDocument;
  strictReactionMsgs?: ReactionRoleMessageDocument[];
  managedRoles?: Set<string>;
}

export async function runVerificationJob(
  job: VerificationRequest,
  apiKeyOverride?: string,
  cache?: VerificationCache,
): Promise<VerificationSuccessResponse | VerificationFailureResponse | null> {
  // Use the logger to clear the ESLint error and add execution observability
  const finishSync = logger.time();

  // ==========================================
  // 1. FAST SYNCHRONOUS CONFIG LOOKUPS (CACHED)
  // ==========================================
  const config =
    cache?.config ?? GuildConfigs.find({ guild_id: job.guild_id })[0];
  if (!config) throw new Error("Guild not configured.");
  if (cache && !cache.config) cache.config = config;

  const apiKeys =
    cache?.apiKeys ?? GuildApiKeys.find({ guild_id: job.guild_id });
  if (apiKeys.length === 0) throw new Error("No API keys found for guild.");
  if (cache && !cache.apiKeys) cache.apiKeys = apiKeys;

  const factionMappings =
    cache?.factionMappings ??
    FactionRoles.find({
      guild_id: job.guild_id,
      enabled: true,
    });
  if (cache && !cache.factionMappings) cache.factionMappings = factionMappings;

  const mercConfig =
    cache?.mercConfig !== undefined
      ? cache.mercConfig
      : MercenaryConfigs.find({
          guild_id: job.guild_id,
        })[0];
  if (cache && cache.mercConfig === undefined) cache.mercConfig = mercConfig;

  const isMerc = MercenaryRegisteredMercs.find({
    guild_id: job.guild_id,
    discord_id: job.discord_id,
    is_active: true,
  })[0];

  const strictReactionMsgs =
    cache?.strictReactionMsgs ??
    ReactionRoleMessages.find({
      guild_id: job.guild_id,
      sync_roles: true,
    });
  if (cache && !cache.strictReactionMsgs)
    cache.strictReactionMsgs = strictReactionMsgs;

  // ==========================================
  // 2. COMPILE THE MANAGED ROLE BOUNDARY (CACHED)
  // ==========================================
  const managedRoles = cache?.managedRoles ?? new Set<string>();

  // Helper to handle legacy double-encoded JSON arrays (e.g. "[\"role1\"]" instead of ["role1"])
  const parseArray = (val: unknown): string[] => {
    if (Array.isArray(val)) return val;
    if (typeof val === "string") {
      try {
        const p = JSON.parse(val);
        if (Array.isArray(p)) return p;
      } catch {
        /* empty */
      }
    }
    return [];
  };

  const mercRoleIds = mercConfig?.merc_role_ids || [];

  if (!cache?.managedRoles) {
    if (config.verified_role_id) managedRoles.add(config.verified_role_id);
    parseArray(config.verified_role_ids).forEach((id) => managedRoles.add(id));

    factionMappings.forEach((mapping: FactionRoleMappingDocument) => {
      parseArray(mapping.member_role_ids).forEach((id) => managedRoles.add(id));
      parseArray(mapping.leader_role_ids).forEach((id) => managedRoles.add(id));
    });

    mercRoleIds.forEach((id: string) => managedRoles.add(id));

    strictReactionMsgs.forEach((msg: ReactionRoleMessageDocument) => {
      const mappings = ReactionRoleMappings.find({
        message_id: msg.message_id,
      });
      mappings.forEach((m: ReactionRoleMappingDocument) => managedRoles.add(m.role_id));
    });

    parseArray(config.strict_faction_role_ids).forEach((id) =>
      managedRoles.add(id),
    );

    if (cache) cache.managedRoles = managedRoles;
  }

  // ==========================================
  // 3. FETCH USER FROM TORN API
  // ==========================================
  const activeKey =
    apiKeyOverride ||
    getNextApiKey(
      job.guild_id,
      apiKeys.map((k) =>
        decryptApiKey(k.api_key_encrypted, process.env.ENCRYPTION_KEY!),
      ),
    );

  let response: UserGenericResponse;
  try {
    response = await tornApi.get<UserGenericResponse>("/user", {
      apiKey: activeKey,
      queryParams: {
        selections: ["discord", "faction", "profile"],
        id: job.discord_id,
      },
    });
  } catch (error) {
    if (error instanceof TornError) {
      if (error.code === 6) {
        // User is not linked to Torn. Strip their roles and reset nickname.
        const rolesToRemove = Array.from(managedRoles).filter((roleId) =>
          job.current_role_ids.includes(roleId),
        );
        const packet: VerificationSuccessResponse = {
          guild_id: job.guild_id,
          channel_id: job.channel_id,
          discord_id: job.discord_id,
          roles_to_add: null,
          roles_to_remove: rolesToRemove.length > 0 ? rolesToRemove : null,
          new_nickname: "", // Empty string removes the nickname
        };

        // Remove them from verified users db
        VerifiedUsers.delete(job.discord_id);

        finishSync();
        return packet;
      }

      const packet: VerificationFailureResponse = {
        guild_id: job.guild_id,
        channel_id: job.channel_id,
        discord_id: job.discord_id,
        error: { message: error.message },
      };

      logger.error("Torn Error: ", error.message);
      finishSync();
      return packet;
    }

    logger.error("Unknown error", error);

    const packet: VerificationFailureResponse = {
      guild_id: job.guild_id,
      channel_id: job.channel_id,
      discord_id: job.discord_id,
      error: { message: "Unknown error" },
    };
    finishSync();
    return packet;
  }

  if (!response.discord || !response.profile?.id) {
    const packet: VerificationFailureResponse = {
      guild_id: job.guild_id,
      channel_id: job.channel_id,
      discord_id: job.discord_id,
      error: { message: "Not verified on Torn Discord." },
    };

    finishSync();
    return packet;
  }

  // ==========================================
  // 4. CALCULATE TARGET ROLES
  // ==========================================
  const targetRoles = new Set<string>();
  const tornId = response.profile.id;
  const tornName = response.profile.name;
  const factionId = response.faction?.id || null;
  const factionTag = response.faction?.tag || null;

  if (config.verified_role_id) targetRoles.add(config.verified_role_id);
  parseArray(config.verified_role_ids).forEach((id) => targetRoles.add(id));

  let isInMappedFaction = false;
  if (factionId) {
    const mapping = factionMappings.find(
      (m: FactionRoleMappingDocument) => m.faction_id === factionId,
    );
    if (mapping) {
      isInMappedFaction = true;
      parseArray(mapping.member_role_ids).forEach((id) => targetRoles.add(id));

      // Check if the user is a Leader or Co-leader using their profile response directly
      if (
        response.faction?.position === "Leader" ||
        response.faction?.position === "Co-leader"
      ) {
        parseArray(mapping.leader_role_ids).forEach((id) =>
          targetRoles.add(id),
        );
      }
    }
  }

  if (isInMappedFaction) {
    parseArray(config.strict_faction_role_ids).forEach((roleId) => {
      if (job.current_role_ids.includes(roleId)) {
        targetRoles.add(roleId);
      }
    });
  }

  if (isMerc) {
    mercRoleIds.forEach((id: string) => targetRoles.add(id));
  }

  strictReactionMsgs.forEach((msg: ReactionRoleMessageDocument) => {
    if (msg.required_role_id && !targetRoles.has(msg.required_role_id)) {
      const mappings = ReactionRoleMappings.find({
        message_id: msg.message_id,
      });
      mappings.forEach((m) => targetRoles.delete(m.role_id));
    }
  });

  // ==========================================
  // 5. UPDATE DATABASE & CALCULATE DIFF
  // ==========================================
  const existingUser = VerifiedUsers.find({ discord_id: job.discord_id })[0];

  const userDoc: VerifiedUserDocument = {
    id: existingUser?.id || job.discord_id,
    discord_id: job.discord_id,
    torn_id: tornId,
    torn_name: tornName,
    faction_id: factionId,
    faction_tag: factionTag,
    updated_at: new Date().toISOString(),
  };

  VerifiedUsers.insertOne(userDoc);

  const targetNickname = (config.nickname_template || "{name} [{id}]")
    .replace("{name}", tornName)
    .replace("{id}", tornId.toString())
    .replace("{tag}", factionTag || "");

  // 1. Roles to Add: Must be in targetRoles but NOT in current roles
  const rolesToAdd = Array.from(targetRoles).filter(
    (roleId) => !job.current_role_ids.includes(roleId),
  );

  // 2. Roles to Remove: Must be in managedRoles, NOT in targetRoles, but IS in current roles
  const rolesToRemove = Array.from(managedRoles).filter(
    (roleId) =>
      !targetRoles.has(roleId) && job.current_role_ids.includes(roleId),
  );

  // 3. Nickname: Null if it's already correct
  const newNickname =
    targetNickname === job.current_nickname ? null : targetNickname;

  const packet: VerificationSuccessResponse = {
    guild_id: job.guild_id,
    channel_id: job.channel_id,
    discord_id: job.discord_id,
    roles_to_add: rolesToAdd.length > 0 ? rolesToAdd : null,
    roles_to_remove: rolesToRemove.length > 0 ? rolesToRemove : null,
    new_nickname: newNickname,
  };

  finishSync();
  return packet;
}
