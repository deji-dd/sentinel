import { Logger } from "@sentinel/shared";
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
  type VerificationTargetState,

  // Explicitly importing all document types to fix the implicit 'any' errors
  type GuildConfigDocument,
  type GuildApiKeyDocument,
  type FactionRoleMappingDocument,
  type MercenaryConfigDocument,
  type MercenaryRegisteredMercDocument,
  type ReactionRoleMessageDocument,
  type ReactionRoleMappingDocument,
  type VerifiedUserDocument,
} from "@sentinel/shared";
import { tornApi } from "@sentinel/shared";

const logger = new Logger("verification_engine");

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
}

export async function calculateVerificationTargetState(
  guildId: string,
  discordId: string,
  cache: VerificationCache,
): Promise<VerificationTargetState> {
  // Use the logger to clear the ESLint error and add execution observability
  logger.debug(
    `Calculating target state for Discord ID: ${discordId} in Guild: ${guildId}`,
  );

  // ==========================================
  // 1. FAST SYNCHRONOUS CONFIG LOOKUPS
  // ==========================================
  // Replaced findOne with find()[0] and added strict type annotations
  const config = GuildConfigs.find(
    (c: GuildConfigDocument) => c.guild_id === guildId,
  )[0];
  if (!config) throw new Error("Guild not configured.");

  const apiKeys = GuildApiKeys.find(
    (k: GuildApiKeyDocument) => k.guild_id === guildId,
  );
  if (apiKeys.length === 0) throw new Error("No API keys found for guild.");

  const factionMappings = FactionRoles.find(
    (f: FactionRoleMappingDocument) => f.guild_id === guildId && f.enabled,
  );
  const mercConfig = MercenaryConfigs.find(
    (m: MercenaryConfigDocument) => m.guild_id === guildId,
  )[0];
  const isMerc = MercenaryRegisteredMercs.find(
    (m: MercenaryRegisteredMercDocument) =>
      m.guild_id === guildId && m.discord_id === discordId && m.is_active,
  )[0];
  const strictReactionMsgs = ReactionRoleMessages.find(
    (r: ReactionRoleMessageDocument) => r.guild_id === guildId && r.sync_roles,
  );

  // ==========================================
  // 2. COMPILE THE MANAGED ROLE BOUNDARY
  // ==========================================
  const managedRoles = new Set<string>();

  if (config.verified_role_id) managedRoles.add(config.verified_role_id);
  config.verified_role_ids.forEach((id) => managedRoles.add(id));

  factionMappings.forEach((mapping) => {
    mapping.member_role_ids.forEach((id) => managedRoles.add(id));
    mapping.leader_role_ids.forEach((id) => managedRoles.add(id));
  });

  const mercRoleIds = mercConfig?.merc_role_ids || [];
  mercRoleIds.forEach((id) => managedRoles.add(id));

  strictReactionMsgs.forEach((msg) => {
    const mappings = ReactionRoleMappings.find(
      (m: ReactionRoleMappingDocument) => m.message_id === msg.message_id,
    );
    mappings.forEach((m) => managedRoles.add(m.role_id));
  });

  // ==========================================
  // 3. FETCH USER FROM TORN API
  // ==========================================
  const activeKey = getNextApiKey(
    guildId,
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
        id: discordId,
      },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      guildId,
      discordId,
      targetNickname: "",
      managedRoleIds: [],
      targetRoleIds: [],
      isNewUser: false,
      isUpdate: false,
      status: errorMsg.includes("Incorrect ID") ? "not_linked" : "error",
      errorMessage: errorMsg,
    };
  }

  if (!response.discord || !response.profile?.id) {
    return {
      guildId,
      discordId,
      targetNickname: "",
      managedRoleIds: [],
      targetRoleIds: [],
      isNewUser: false,
      isUpdate: false,
      status: "error",
      errorMessage: "Torn API returned incomplete data.",
    };
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
  config.verified_role_ids.forEach((id) => targetRoles.add(id));

  if (factionId) {
    const mapping = factionMappings.find((m) => m.faction_id === factionId);
    if (mapping) {
      mapping.member_role_ids.forEach((id) => targetRoles.add(id));

      if (cache.factionLeaders.get(factionId)?.has(tornId)) {
        mapping.leader_role_ids.forEach((id) => targetRoles.add(id));
      }
    }
  }

  if (isMerc) {
    mercRoleIds.forEach((id) => targetRoles.add(id));
  }

  strictReactionMsgs.forEach((msg) => {
    if (msg.required_role_id && !targetRoles.has(msg.required_role_id)) {
      const mappings = ReactionRoleMappings.find(
        (m: ReactionRoleMappingDocument) => m.message_id === msg.message_id,
      );
      mappings.forEach((m) => targetRoles.delete(m.role_id));
    }
  });

  // ==========================================
  // 5. UPDATE DATABASE & NICKNAME
  // ==========================================
  const existingUser = VerifiedUsers.find(
    (u: VerifiedUserDocument) => u.discord_id === discordId,
  )[0];
  const isNewUser = !existingUser;

  // Use strict boolean evaluation for isUpdate to satisfy TypeScript
  const isUpdate = existingUser
    ? existingUser.torn_name !== tornName ||
      existingUser.faction_id !== factionId
    : false;

  const userDoc: VerifiedUserDocument = {
    id: existingUser?.id || discordId,
    discord_id: discordId,
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

  return {
    guildId,
    discordId,
    targetNickname,
    managedRoleIds: Array.from(managedRoles),
    targetRoleIds: Array.from(targetRoles),
    isNewUser,
    isUpdate,
    status: "success",
    logData: {
      tornId,
      tornName,
      factionName: response.faction?.name || null,
    },
  };
}
