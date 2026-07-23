import { FastifyInstance } from "fastify";
import {
  GuildConfigs,
  GuildInitRequests,
  SystemModules,
  GuildApiKeys,
  Logger,
  decryptApiKey,
  GuildConfigDocument,
  FactionRoles,
  FactionRoleMappingDocument,
  GuildConfigResponse,
  SystemModulesListResponse,
  UpdateGuildConfigPayload,
  MaskedGuildApiKey,
  UserConfig,
  validateAndFetchFactionDetails,
  TerritoryBlueprints,
  TerritoryBlueprintSummary,
  TerritoryListResponse,
  ReactionRoleMessages,
  ReactionRoleMappings,
  ReactionRoleMessagesListResponse,
  CreateReactionRoleMessagePayload,
  UpdateReactionRoleMessagePayload,
  AddEmojiMappingPayload,
} from "@sentinel/shared";
import { randomUUID } from "crypto";

const logger = new Logger("api_guilds");

async function resolveDiscordUsername(providedBy: string): Promise<string> {
  if (!providedBy) return "Unknown";
  if (!/^\d{17,20}$/.test(providedBy)) {
    return providedBy;
  }
  const botToken = process.env.DISCORD_BOT_TOKEN;

  if (!botToken) return providedBy;
  try {
    const res = await fetch(`https://discord.com/api/v10/users/${providedBy}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (res.ok) {
      const user = await res.json();
      return user.global_name || user.username || providedBy;
    }
  } catch {}
  return providedBy;
}

export async function guildsRoutes(fastify: FastifyInstance) {
  // Get all territory blueprints list
  fastify.get<{ Reply: TerritoryListResponse | { error: string } }>(
    "/territories/list",
    async (request, reply) => {
      try {
        const blueprints = TerritoryBlueprints.find({});
        const territories: TerritoryBlueprintSummary[] = blueprints
          .map((b) => ({
            id: b.id,
            sector: b.data.sector,
            size: b.data.size,
            slots: b.data.slots,
            respect: b.data.respect || 0,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));

        return reply.send(territories);
      } catch (err) {
        logger.error("Error fetching territory blueprints list:", err);
        return reply.status(500).send({ error: "Internal server error" });
      }
    },
  );

  // Get all system modules — only return the canonical seeded module IDs
  const KNOWN_MODULE_IDS = new Set([
    "verification",
    "territories",
    "bazaar",
    "reactions",
  ]);
  fastify.get("/modules/list", async (request, reply) => {
    try {
      const modules = SystemModules.find({}).filter((m) =>
        KNOWN_MODULE_IDS.has(m.module_id),
      );
      return reply.send(modules);
    } catch (err) {
      logger.error("Error fetching system modules:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  // Deploy slash commands to Discord guild
  fastify.post("/:id/deploy-commands", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const token = process.env.DISCORD_BOT_TOKEN;
      const clientId =
        process.env.DISCORD_CLIENT_ID || process.env.AUTH_DISCORD_ID;
      const adminGuildId = process.env.ADMIN_GUILD_ID;

      if (!token || !clientId) {
        return reply.status(500).send({
          error: "Discord Bot Token or Client ID is missing in API configuration.",
        });
      }

      const configCmd = {
        name: "config",
        description: "Open the web dashboard to configure Sentinel for this server",
      };
      const ttSelectorCmd = {
        name: "tt-selector",
        description: "Open the interactive Territory Selector tool",
      };
      const verifyCmd = {
        name: "verify",
        description: "Verify your Torn account with Discord",
      };
      const verifyallCmd = {
        name: "verifyall",
        description: "Force re-verify all members in the server",
      };
      const assaultCheckCmd = {
        name: "assault-check",
        description: "Check active territory assaults and wall statuses",
      };
      const burnMapCmd = {
        name: "burn-map",
        description: "Generate territory burn map image",
      };
      const allianceMapCmd = {
        name: "alliance-map",
        description: "Generate alliance territory map image",
      };

      const commandsByModule: Record<string, unknown[]> = {
        verification: [verifyCmd, verifyallCmd],
        verify: [verifyCmd, verifyallCmd],
        admin: [configCmd],
        territories: [assaultCheckCmd, burnMapCmd, allianceMapCmd, ttSelectorCmd],
      };

      let guildCommands: unknown[] = [];

      if (id === adminGuildId) {
        guildCommands = [
          configCmd,
          assaultCheckCmd,
          burnMapCmd,
          allianceMapCmd,
          ttSelectorCmd,
          verifyCmd,
          verifyallCmd,
        ];
      } else {
        const configDoc = GuildConfigs.findOne(id);
        let enabledModules: string[] = [
          "admin",
          "verification",
          "territories",
          "reactions",
        ];
        if (configDoc && configDoc.enabled_modules) {
          if (Array.isArray(configDoc.enabled_modules)) {
            enabledModules = configDoc.enabled_modules as string[];
          } else if (typeof configDoc.enabled_modules === "string") {
            try {
              enabledModules = JSON.parse(configDoc.enabled_modules);
            } catch {}
          }
        }

        if (!enabledModules.includes("admin")) {
          enabledModules.push("admin");
        }

        for (const mod of enabledModules) {
          if (commandsByModule[mod]) {
            guildCommands.push(...commandsByModule[mod]);
          }
        }
      }

      const res = await fetch(
        `https://discord.com/api/v10/applications/${clientId}/guilds/${id}/commands`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bot ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(guildCommands),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        logger.error(`Discord API error deploying commands for guild ${id}:`, errText);
        return reply.status(res.status).send({
          error: `Discord API returned status ${res.status}: ${errText}`,
        });
      }

      logger.info(
        `Successfully deployed ${guildCommands.length} slash commands to guild ${id}`,
      );
      return reply.send({
        success: true,
        deployedCount: guildCommands.length,
        message: `Successfully deployed ${guildCommands.length} slash commands to Discord guild.`,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to deploy commands for guild ${id}:`, err);
      return reply.status(500).send({
        error: errorMsg || "Failed to deploy slash commands to Discord.",
      });
    }
  });

  // Pre-handler hook to authenticate internal requests
  fastify.addHook("preHandler", async (request, reply) => {
    const secret = request.headers["x-sentinel-secret"];
    const expectedSecret = process.env.SENTINEL_INTERNAL_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      return reply.status(403).send({ error: "Unauthorized internal request" });
    }
  });

  // Get guild configuration
  fastify.get("/:id/config", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      if (!id) {
        return reply.status(400).send({ error: "Guild ID is required" });
      }

      const guildConfig = GuildConfigs.find({ guild_id: id })[0];
      if (!guildConfig) {
        return reply.send({ initialized: false });
      }

      // Retrieve all keys for this guild and mask their values
      const keys = GuildApiKeys.find({ guild_id: id }) || [];
      const encryptionKey = process.env.ENCRYPTION_KEY;
      const apiKeys = await Promise.all(
        keys.map(async (k) => {
          let masked = "•••• •••• ••••";
          try {
            if (encryptionKey) {
              const decrypted = decryptApiKey(
                k.api_key_encrypted,
                encryptionKey,
              );
              if (decrypted && decrypted.length >= 4) {
                masked = `•••• •••• •••• ${decrypted.slice(-4)}`;
              }
            }
          } catch (err) {
            logger.warn(`Failed to decrypt and mask api key ${k.id}:`, err);
          }
          const providedByName = await resolveDiscordUsername(k.provided_by);
          return {
            id: k.id,
            masked,
            is_primary: k.is_primary,
            provided_by: providedByName,
          };
        }),
      );

      return reply.send({
        initialized: true,
        config: guildConfig,
        hasApiKey: keys.length > 0,
        apiKeys,
      });
    } catch (err) {
      logger.error("Error fetching guild config:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  // Update guild configuration
  fastify.put("/:id/config", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Partial<GuildConfigDocument> & {
        api_key?: string;
      };

      if (!id) {
        return reply.status(400).send({ error: "Guild ID is required" });
      }

      // 1. Fetch or create config document
      let guildConfig = GuildConfigs.find({ guild_id: id })[0];
      const isNew = !guildConfig;

      const updatedConfig = {
        id: guildConfig?.id || randomUUID(),
        guild_id: id,
        verify_on_join:
          body.verify_on_join !== undefined
            ? body.verify_on_join
            : (guildConfig?.verify_on_join ?? false),
        verify_cron:
          body.verify_cron !== undefined
            ? body.verify_cron
            : (guildConfig?.verify_cron ?? false),
        verify_cron_interval:
          body.verify_cron_interval !== undefined
            ? body.verify_cron_interval
            : (guildConfig?.verify_cron_interval ?? 1),
        nickname_template:
          body.nickname_template !== undefined
            ? body.nickname_template
            : (guildConfig?.nickname_template ??
              "[{faction_tag}] {name} [{id}]"),
        verified_role_id:
          body.verified_role_id !== undefined
            ? body.verified_role_id
            : (guildConfig?.verified_role_id ?? null),
        verified_role_ids:
          body.verified_role_ids !== undefined
            ? body.verified_role_ids
            : (guildConfig?.verified_role_ids ?? []),
        enabled_modules:
          body.enabled_modules !== undefined
            ? body.enabled_modules
            : (guildConfig?.enabled_modules ?? ["admin"]),
        admin_role_ids:
          body.admin_role_ids !== undefined
            ? body.admin_role_ids
            : (guildConfig?.admin_role_ids ?? []),
        log_channel_id:
          body.log_channel_id !== undefined
            ? body.log_channel_id
            : (guildConfig?.log_channel_id ?? null),
        faction_list_channel_id:
          body.faction_list_channel_id !== undefined
            ? body.faction_list_channel_id
            : (guildConfig?.faction_list_channel_id ?? null),
        faction_list_message_ids: guildConfig?.faction_list_message_ids ?? [],
        tt_full_channel_id:
          body.tt_full_channel_id !== undefined
            ? body.tt_full_channel_id
            : (guildConfig?.tt_full_channel_id ?? null),
        tt_filtered_channel_id:
          body.tt_filtered_channel_id !== undefined
            ? body.tt_filtered_channel_id
            : (guildConfig?.tt_filtered_channel_id ?? null),
        tt_territory_ids:
          body.tt_territory_ids !== undefined
            ? body.tt_territory_ids
            : (guildConfig?.tt_territory_ids ?? []),
        tt_faction_ids:
          body.tt_faction_ids !== undefined
            ? body.tt_faction_ids
            : (guildConfig?.tt_faction_ids ?? []),
      };

      if (isNew) {
        GuildConfigs.insertOne(updatedConfig);
      } else {
        GuildConfigs.update(updatedConfig);
      }

      // 2. Handle legacy api_key if provided
      if (body.api_key) {
        const encryptionKey = process.env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          throw new Error(
            "ENCRYPTION_KEY environment variable is missing on API gateway",
          );
        }

        const { encryptApiKey } = await import("@sentinel/shared");
        const encrypted = encryptApiKey(body.api_key, encryptionKey);

        const existingKeys = GuildApiKeys.find({ guild_id: id });
        const primaryKey =
          existingKeys.find((k) => k.is_primary) || existingKeys[0];

        if (primaryKey) {
          GuildApiKeys.update({
            ...primaryKey,
            api_key_encrypted: encrypted,
            provided_by: "api-dashboard",
          });
        } else {
          GuildApiKeys.insertOne({
            id: randomUUID(),
            guild_id: id,
            user_id: 0,
            api_key_encrypted: encrypted,
            is_primary: true,
            provided_by: "api-dashboard",
          });
        }
      }

      return reply.send({ success: true, config: updatedConfig });
    } catch (err: any) {
      logger.error("Error updating guild config:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  // Verify and Add API Key
  fastify.post("/:id/api-keys", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { api_key } = request.body as { api_key: string };
      if (!id || !api_key) {
        return reply
          .status(400)
          .send({ error: "Guild ID and API Key are required" });
      }

      const encryptionKey = process.env.ENCRYPTION_KEY;
      if (!encryptionKey) {
        throw new Error("ENCRYPTION_KEY is missing on API gateway");
      }

      // Verify the key against the Torn API first!
      let userId: number | null = null;
      try {
        const { TornApiClient } = await import("@sentinel/shared");
        const client = new TornApiClient();
        const data = await client.get("/user/basic", { apiKey: api_key });
        userId = data.profile?.id || null;
      } catch (err: any) {
        return reply
          .status(400)
          .send({ error: `Invalid API key or Torn API error: ${err.message}` });
      }

      if (!userId) {
        return reply
          .status(400)
          .send({ error: "Could not resolve Torn user ID from this key." });
      }

      // Encrypt the key
      const { encryptApiKey } = await import("@sentinel/shared");
      const encrypted = encryptApiKey(api_key, encryptionKey);

      // Insert key
      const existingKeys = GuildApiKeys.find({ guild_id: id }) || [];
      const isPrimary = existingKeys.length === 0;

      const providedByRaw =
        (request.body as { provided_by?: string }).provided_by ||
        "api-dashboard";
      const providedByName = await resolveDiscordUsername(providedByRaw);

      const newKeyDoc = {
        id: randomUUID(),
        guild_id: id,
        user_id: userId,
        api_key_encrypted: encrypted,
        is_primary: isPrimary,
        provided_by: providedByName,
      };
      GuildApiKeys.insertOne(newKeyDoc);

      let masked = "•••• •••• ••••";
      if (api_key.length >= 4) {
        masked = `•••• •••• •••• ${api_key.slice(-4)}`;
      }

      return reply.send({
        success: true,
        apiKey: {
          id: newKeyDoc.id,
          masked,
          is_primary: newKeyDoc.is_primary,
          provided_by: newKeyDoc.provided_by,
        },
      });
    } catch (err: any) {
      logger.error("Error adding guild api key:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  // Delete Guild API Key
  fastify.delete("/:id/api-keys/:keyId", async (request, reply) => {
    try {
      const { id, keyId } = request.params as { id: string; keyId: string };
      if (!id || !keyId) {
        return reply
          .status(400)
          .send({ error: "Guild ID and Key ID are required" });
      }

      const targetKey = GuildApiKeys.find({ id: keyId })[0];
      if (!targetKey) {
        return reply.status(404).send({ error: "API Key not found" });
      }

      GuildApiKeys.delete(keyId);

      // If the deleted key was primary, make another key primary
      if (targetKey.is_primary) {
        const remaining = GuildApiKeys.find({ guild_id: id });
        if (remaining.length > 0) {
          GuildApiKeys.update({
            ...remaining[0],
            is_primary: true,
          });
        }
      }

      return reply.send({ success: true });
    } catch (err: any) {
      logger.error("Error deleting guild api key:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  // Set API Key as primary
  fastify.put("/:id/api-keys/:keyId/primary", async (request, reply) => {
    try {
      const { id, keyId } = request.params as { id: string; keyId: string };
      if (!id || !keyId) {
        return reply
          .status(400)
          .send({ error: "Guild ID and Key ID are required" });
      }

      const keys = GuildApiKeys.find({ guild_id: id });
      const targetKey = keys.find((k) => k.id === keyId);
      if (!targetKey) {
        return reply.status(404).send({ error: "API Key not found" });
      }

      for (const k of keys) {
        GuildApiKeys.update({
          ...k,
          is_primary: k.id === keyId,
        });
      }

      return reply.send({ success: true });
    } catch (err: any) {
      logger.error("Error setting primary guild api key:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  // Check if initialization has been requested
  fastify.get("/:id/request-init", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      if (!id) {
        return reply.status(400).send({ error: "Guild ID is required" });
      }

      const reqDoc = GuildInitRequests.find({ guild_id: id })[0];
      if (!reqDoc) {
        return reply.send({ requested: false });
      }

      return reply.send({
        requested: true,
        requested_by: reqDoc.requested_by,
        requested_at: reqDoc.requested_at,
      });
    } catch (err) {
      logger.error("Error checking guild init request:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  // Record an initialization request
  fastify.post("/:id/request-init", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { userId } = request.body as { userId: string };

      if (!id || !userId) {
        return reply
          .status(400)
          .send({ error: "Guild ID and User ID are required" });
      }

      const existing = GuildInitRequests.find({ guild_id: id })[0];
      if (existing) {
        return reply
          .status(400)
          .send({ error: "Initialization request already exists" });
      }

      GuildInitRequests.insertOne({
        id: randomUUID(),
        guild_id: id,
        requested_by: userId,
        requested_at: Date.now(),
      });

      return reply.send({ success: true });
    } catch (err) {
      logger.error("Error recording guild init request:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  // Delete guild configuration (De-initialize)
  fastify.delete("/:id/config", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      if (!id) {
        return reply.status(400).send({ error: "Guild ID is required" });
      }

      // Delete configuration
      const configs = GuildConfigs.find({ guild_id: id });
      for (const c of configs) {
        GuildConfigs.delete(c.id);
      }

      // Delete API Keys associated with the guild
      const keys = GuildApiKeys.find({ guild_id: id });
      for (const key of keys) {
        GuildApiKeys.delete(key.id);
      }

      // Delete Init Requests associated with the guild
      const reqs = GuildInitRequests.find({ guild_id: id });
      for (const r of reqs) {
        GuildInitRequests.delete(r.id);
      }

      return reply.send({ success: true });
    } catch (err: any) {
      logger.error("Error deleting guild config:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  // Get all faction role mappings for a guild
  fastify.get("/:id/faction-roles", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      if (!id) {
        return reply.status(400).send({ error: "Guild ID is required" });
      }
      const mappings = FactionRoles.find({ guild_id: id });
      return reply.send(mappings);
    } catch (err: any) {
      logger.error("Error fetching faction roles:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  // Helper to resolve an API key for a guild
  function getApiKeyForGuild(guildId: string): string {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) return "";

    const keys = GuildApiKeys.find({ guild_id: guildId, is_primary: true });
    if (keys.length > 0) {
      try {
        const dec = decryptApiKey(keys[0].api_key_encrypted, encryptionKey);
        if (dec) return dec;
      } catch {}
    }

    const allKeys = GuildApiKeys.find({ guild_id: guildId });
    if (allKeys.length > 0) {
      try {
        const dec = decryptApiKey(allKeys[0].api_key_encrypted, encryptionKey);
        if (dec) return dec;
      } catch {}
    }

    const globalConfig = UserConfig.findOne("global");
    if (globalConfig?.api_key) {
      try {
        const dec = decryptApiKey(globalConfig.api_key, encryptionKey);
        if (dec) return dec;
      } catch {}
    }

    return "";
  }

  // Fetch faction info by faction ID using validateAndFetchFactionDetails
  fastify.get("/:id/faction-info/:factionId", async (request, reply) => {
    try {
      const { id, factionId } = request.params as {
        id: string;
        factionId: string;
      };
      const fNum = Number(factionId);
      if (isNaN(fNum) || fNum <= 0) {
        return reply.status(400).send({ error: "Invalid Faction ID" });
      }

      const apiKey = getApiKeyForGuild(id);
      const factionDoc = await validateAndFetchFactionDetails(fNum, apiKey);
      if (!factionDoc?.data) {
        return reply.status(404).send({ error: "Faction not found" });
      }

      return reply.send({
        faction_id: fNum,
        name: factionDoc.data.name,
        tag: factionDoc.data.tag || null,
      });
    } catch (err: any) {
      logger.error("Error fetching faction info:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  // Create a new faction role mapping
  fastify.post("/:id/faction-roles", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      if (!id) {
        return reply.status(400).send({ error: "Guild ID is required" });
      }
      const body = request.body as Omit<
        FactionRoleMappingDocument,
        "id" | "guild_id"
      >;

      let factionName = body.faction_name || null;
      const apiKey = getApiKeyForGuild(id);
      if (apiKey && body.faction_id) {
        const factionDoc = await validateAndFetchFactionDetails(
          Number(body.faction_id),
          apiKey,
        );
        if (factionDoc?.data?.name) {
          factionName = factionDoc.data.name;
        }
      }

      const newMapping = FactionRoles.insertOne({
        id: randomUUID(),
        guild_id: id,
        faction_id: Number(body.faction_id),
        faction_name: factionName,
        member_role_ids: body.member_role_ids || [],
        leader_role_ids: body.leader_role_ids || [],
        enabled: body.enabled !== undefined ? body.enabled : true,
      });

      return reply.send(newMapping);
    } catch (err: any) {
      logger.error("Error creating faction role mapping:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  // Update an existing faction role mapping
  fastify.put("/:id/faction-roles/:mappingId", async (request, reply) => {
    try {
      const { id, mappingId } = request.params as {
        id: string;
        mappingId: string;
      };
      if (!id || !mappingId) {
        return reply
          .status(400)
          .send({ error: "Guild ID and Mapping ID are required" });
      }

      const body = request.body as Partial<
        Omit<FactionRoleMappingDocument, "id" | "guild_id">
      >;
      const existing = FactionRoles.find({ id: mappingId })[0];
      if (!existing || existing.guild_id !== id) {
        return reply
          .status(404)
          .send({ error: "Faction role mapping not found" });
      }

      const factionIdToUse =
        body.faction_id !== undefined
          ? Number(body.faction_id)
          : existing.faction_id;
      let factionName = existing.faction_name;
      const apiKey = getApiKeyForGuild(id);
      if (apiKey && factionIdToUse) {
        const factionDoc = await validateAndFetchFactionDetails(
          factionIdToUse,
          apiKey,
        );
        if (factionDoc?.data?.name) {
          factionName = factionDoc.data.name;
        }
      }

      const updated = {
        ...existing,
        faction_id: factionIdToUse,
        faction_name: factionName,
        member_role_ids:
          body.member_role_ids !== undefined
            ? body.member_role_ids
            : existing.member_role_ids,
        leader_role_ids:
          body.leader_role_ids !== undefined
            ? body.leader_role_ids
            : existing.leader_role_ids,
        enabled: body.enabled !== undefined ? body.enabled : existing.enabled,
      };

      FactionRoles.update(updated);
      return reply.send(updated);
    } catch (err: any) {
      logger.error("Error updating faction role mapping:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  // Delete a faction role mapping
  fastify.delete("/:id/faction-roles/:mappingId", async (request, reply) => {
    try {
      const { id, mappingId } = request.params as {
        id: string;
        mappingId: string;
      };
      if (!id || !mappingId) {
        return reply
          .status(400)
          .send({ error: "Guild ID and Mapping ID are required" });
      }

      const existing = FactionRoles.find({ id: mappingId })[0];
      if (!existing || existing.guild_id !== id) {
        return reply
          .status(404)
          .send({ error: "Faction role mapping not found" });
      }

      FactionRoles.delete(mappingId);
      return reply.send({ success: true });
    } catch (err: any) {
      logger.error("Error deleting faction role mapping:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  // ─── Reaction Roles ──────────────────────────────────────────────────────────

  /**
   * GET /:id/reaction-roles
   * List all reaction role messages for a guild, each with their emoji mappings.
   */
  fastify.get<{ Reply: ReactionRoleMessagesListResponse | { error: string } }>(
    "/:id/reaction-roles",
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const messages = ReactionRoleMessages.find({ guild_id: id });
        const result: ReactionRoleMessagesListResponse = messages.map(
          (msg) => ({
            ...msg,
            emojis: ReactionRoleMappings.find({ message_id: msg.id }),
          }),
        );
        return reply.send(result);
      } catch (err: any) {
        logger.error("Error listing reaction role messages:", err);
        return reply
          .status(500)
          .send({ error: err.message || "Internal server error" });
      }
    },
  );

  /**
   * POST /:id/reaction-roles
   * Create a new reaction role message record.
   */
  fastify.post("/:id/reaction-roles", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as CreateReactionRoleMessagePayload;

      if (!body.title?.trim()) {
        return reply.status(400).send({ error: "title is required" });
      }
      if (!body.channel_id?.trim()) {
        return reply.status(400).send({ error: "channel_id is required" });
      }

      const doc = {
        id: randomUUID(),
        guild_id: id,
        message_id: "", // Populated by the bot worker when it posts the message
        channel_id: body.channel_id,
        title: body.title.trim(),
        description: "",
        required_role_id: body.required_role_id ?? null,
        sync_roles: false,
      };
      ReactionRoleMessages.insertOne(doc);

      return reply
        .status(201)
        .send({ success: true, message: { ...doc, emojis: [] } });
    } catch (err: any) {
      logger.error("Error creating reaction role message:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  /**
   * PATCH /:id/reaction-roles/:msgId
   * Update metadata (title, channel, required role) of an existing message.
   */
  fastify.patch("/:id/reaction-roles/:msgId", async (request, reply) => {
    try {
      const { id, msgId } = request.params as { id: string; msgId: string };
      const body = request.body as UpdateReactionRoleMessagePayload;

      const existing = ReactionRoleMessages.findOne(msgId);
      if (!existing || existing.guild_id !== id) {
        return reply
          .status(404)
          .send({ error: "Reaction role message not found" });
      }

      const updated = {
        ...existing,
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.channel_id !== undefined
          ? { channel_id: body.channel_id }
          : {}),
        ...(body.required_role_id !== undefined
          ? { required_role_id: body.required_role_id }
          : {}),
      };
      ReactionRoleMessages.update(updated);

      const emojis = ReactionRoleMappings.find({ message_id: msgId });
      return reply.send({ success: true, message: { ...updated, emojis } });
    } catch (err: any) {
      logger.error("Error updating reaction role message:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  /**
   * DELETE /:id/reaction-roles/:msgId
   * Delete a message and cascade-delete all its emoji mappings.
   */
  fastify.delete("/:id/reaction-roles/:msgId", async (request, reply) => {
    try {
      const { id, msgId } = request.params as { id: string; msgId: string };

      const existing = ReactionRoleMessages.findOne(msgId);
      if (!existing || existing.guild_id !== id) {
        return reply
          .status(404)
          .send({ error: "Reaction role message not found" });
      }

      // If the message was posted to Discord, delete it from the channel
      if (existing.channel_id && existing.message_id) {
        const botToken = process.env.DISCORD_BOT_TOKEN;
        if (botToken) {
          fetch(
            `https://discord.com/api/v10/channels/${existing.channel_id}/messages/${existing.message_id}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bot ${botToken}` },
            },
          ).catch((err) => {
            logger.warn(
              `Failed to delete Discord message ${existing.message_id}:`,
              err,
            );
          });
        }
      }

      // Cascade delete emoji mappings first
      const mappings = ReactionRoleMappings.find({ message_id: msgId }).concat(
        ReactionRoleMappings.find({ message_id: existing.message_id }),
      );
      for (const m of mappings) {
        ReactionRoleMappings.delete(m.id);
      }
      ReactionRoleMessages.delete(msgId);

      return reply.send({ success: true });
    } catch (err: any) {
      logger.error("Error deleting reaction role message:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  /**
   * POST /:id/reaction-roles/:msgId/emojis
   * Add an emoji → role mapping to a message.
   */
  fastify.post("/:id/reaction-roles/:msgId/emojis", async (request, reply) => {
    try {
      const { id, msgId } = request.params as { id: string; msgId: string };
      const body = request.body as AddEmojiMappingPayload;

      if (!body.emoji?.trim()) {
        return reply.status(400).send({ error: "emoji is required" });
      }
      if (!body.role_id?.trim()) {
        return reply.status(400).send({ error: "role_id is required" });
      }

      const existing = ReactionRoleMessages.findOne(msgId);
      if (!existing || existing.guild_id !== id) {
        return reply
          .status(404)
          .send({ error: "Reaction role message not found" });
      }

      // Prevent duplicate emoji on the same message
      const duplicateEmoji = ReactionRoleMappings.find({
        message_id: msgId,
      }).find((m) => m.emoji === body.emoji.trim());
      if (duplicateEmoji) {
        return reply.status(409).send({
          error: `Emoji ${body.emoji} is already mapped on this message`,
        });
      }

      const mapping = {
        id: randomUUID(),
        message_id: msgId,
        emoji: body.emoji.trim(),
        role_id: body.role_id.trim(),
      };
      ReactionRoleMappings.insertOne(mapping);

      return reply.status(201).send({ success: true, mapping });
    } catch (err: any) {
      logger.error("Error adding emoji mapping:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Internal server error" });
    }
  });

  /**
   * DELETE /:id/reaction-roles/:msgId/emojis/:emojiMappingId
   * Remove a single emoji → role mapping.
   */
  fastify.delete(
    "/:id/reaction-roles/:msgId/emojis/:emojiMappingId",
    async (request, reply) => {
      try {
        const { id, msgId, emojiMappingId } = request.params as {
          id: string;
          msgId: string;
          emojiMappingId: string;
        };

        const message = ReactionRoleMessages.findOne(msgId);
        if (!message || message.guild_id !== id) {
          return reply
            .status(404)
            .send({ error: "Reaction role message not found" });
        }

        const mapping = ReactionRoleMappings.findOne(emojiMappingId);
        if (!mapping || mapping.message_id !== msgId) {
          return reply.status(404).send({ error: "Emoji mapping not found" });
        }

        ReactionRoleMappings.delete(emojiMappingId);

        const botToken = process.env.DISCORD_BOT_TOKEN;
        if (botToken && message.channel_id && message.message_id && mapping.emoji) {
          const formattedEmoji = encodeURIComponent(mapping.emoji.trim());
          fetch(
            `https://discord.com/api/v10/channels/${message.channel_id}/messages/${message.message_id}/reactions/${formattedEmoji}/@me`,
            {
              method: "DELETE",
              headers: { Authorization: `Bot ${botToken}` },
            },
          ).catch((err) => {
            logger.warn(`Failed to delete bot reaction ${mapping.emoji}:`, err);
          });
        }

        return reply.send({ success: true });
      } catch (err: any) {
        logger.error("Error deleting emoji mapping:", err);
        return reply
          .status(500)
          .send({ error: err.message || "Internal server error" });
      }
    },
  );
}
