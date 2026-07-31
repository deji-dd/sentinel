import { FastifyInstance } from "fastify";
import { db } from "@sentinel/database";
import { normalizeModules } from "@sentinel/utils";
import { tornApi, encryptApiKey, hashApiKey } from "@sentinel/torn-api";
import { ipcClient } from "../lib/ipc-client.js";

export async function guildRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/guilds/:guildId/config
  fastify.get<{ Params: { guildId: string } }>(
    "/api/guilds/:guildId/config",
    async (request, reply) => {
      const { guildId } = request.params;

      const config = await db.guildConfig.findUnique({
        where: { guildId },
        include: {
          apiKeys: {
            select: {
              id: true,
              providedBy: true,
              isValid: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          },
          factionRoleMappings: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!config) {
        return reply.send({ initialized: false, config: null, apiKeys: [] });
      }

      // Enrich faction mappings with tagImage + tag from Faction table
      const factionIds = config.factionRoleMappings.map((m) => m.factionId);
      const factions = factionIds.length
        ? await db.faction.findMany({
            where: { id: { in: factionIds } },
            select: { id: true, tag: true, tagImage: true },
          })
        : [];
      const factionMeta = new Map(
        factions.map((f) => [f.id, { tag: f.tag, tagImage: f.tagImage }]),
      );

      const enrichedMappings = config.factionRoleMappings.map((m) => ({
        ...m,
        factionTag: factionMeta.get(m.factionId)?.tag ?? null,
        tagImage: factionMeta.get(m.factionId)?.tagImage ?? null,
      }));

      return reply.send({
        initialized: true,
        config: {
          guildId: config.guildId,
          logChannelId: config.logChannelId,
          adminRoleIds: config.adminRoleIds,
          enabledModules: config.enabledModules,
          verifiedRoleIds: config.verifiedRoleIds,
          nicknameTemplate: config.nicknameTemplate,
          verifyOnJoin: config.verifyOnJoin,
          verifyCron: config.verifyCron,
          verifyCronInterval: config.verifyCronInterval,
          protectedRoleIds: config.protectedRoleIds,
          factionListChannelId: config.factionListChannelId,
          factionListMessageIds: config.factionListMessageIds,
          factionRoleMappings: enrichedMappings,
          ttFullChannelId: config.ttFullChannelId,
          ttFilteredChannelId: config.ttFilteredChannelId,
          ttTerritoryIds: config.ttTerritoryIds,
          ttFactionIds: config.ttFactionIds,
        },
        apiKeys: config.apiKeys,
      });
    },
  );

  // PUT /api/guilds/:guildId/config
  fastify.put<{
    Params: { guildId: string };
    Body: {
      logChannelId?: string | null;
      adminRoleIds?: string[];
      enabledModules?: string[];
      verifiedRoleIds?: string[];
      nicknameTemplate?: string | null;
      verifyOnJoin?: boolean;
      verifyCron?: boolean;
      verifyCronInterval?: number;
      protectedRoleIds?: string[];
      factionListChannelId?: string | null;
      ttFullChannelId?: string | null;
      ttFilteredChannelId?: string | null;
      ttTerritoryIds?: string[];
      ttFactionIds?: number[];
    };
  }>("/api/guilds/:guildId/config", async (request, reply) => {
    const { guildId } = request.params;
    const {
      logChannelId,
      adminRoleIds,
      enabledModules,
      verifiedRoleIds,
      nicknameTemplate,
      verifyOnJoin,
      verifyCron,
      verifyCronInterval,
      protectedRoleIds,
      factionListChannelId,
      ttFullChannelId,
      ttFilteredChannelId,
      ttTerritoryIds,
      ttFactionIds,
    } = request.body;

    const updated = await db.guildConfig.upsert({
      where: { guildId },
      update: {
        ...(logChannelId !== undefined ? { logChannelId } : {}),
        ...(adminRoleIds !== undefined ? { adminRoleIds } : {}),
        ...(enabledModules !== undefined ? { enabledModules: normalizeModules(enabledModules) } : {}),
        ...(verifiedRoleIds !== undefined ? { verifiedRoleIds } : {}),
        ...(nicknameTemplate !== undefined ? { nicknameTemplate } : {}),
        ...(verifyOnJoin !== undefined ? { verifyOnJoin } : {}),
        ...(verifyCron !== undefined ? { verifyCron } : {}),
        ...(verifyCronInterval !== undefined ? { verifyCronInterval } : {}),
        ...(protectedRoleIds !== undefined ? { protectedRoleIds } : {}),
        ...(factionListChannelId !== undefined ? { factionListChannelId } : {}),
        ...(ttFullChannelId !== undefined ? { ttFullChannelId } : {}),
        ...(ttFilteredChannelId !== undefined ? { ttFilteredChannelId } : {}),
        ...(ttTerritoryIds !== undefined ? { ttTerritoryIds } : {}),
        ...(ttFactionIds !== undefined ? { ttFactionIds } : {}),
      },
      create: {
        guildId,
        logChannelId: logChannelId ?? null,
        adminRoleIds: adminRoleIds ?? [],
        enabledModules: enabledModules ? normalizeModules(enabledModules) : ["verification"],
        verifiedRoleIds: verifiedRoleIds ?? [],
        nicknameTemplate: nicknameTemplate ?? null,
        verifyOnJoin: verifyOnJoin ?? false,
        verifyCron: verifyCron ?? false,
        verifyCronInterval: verifyCronInterval ?? 24,
        protectedRoleIds: protectedRoleIds ?? [],
        factionListChannelId: factionListChannelId ?? null,
        ttFullChannelId: ttFullChannelId ?? null,
        ttFilteredChannelId: ttFilteredChannelId ?? null,
        ttTerritoryIds: ttTerritoryIds ?? [],
        ttFactionIds: ttFactionIds ?? [],
      },
    });

    if (factionListChannelId !== undefined) {
      ipcClient.send({ action: "sync_faction_map", data: { guildId } });
    }

    return reply.send({ success: true, config: updated });
  });

  // POST /api/guilds/:guildId/faction-mappings
  fastify.post<{
    Params: { guildId: string };
    Body: {
      factionId: number;
      factionName?: string;
      memberRoleIds?: string[];
      leaderRoleIds?: string[];
    };
  }>("/api/guilds/:guildId/faction-mappings", async (request, reply) => {
    const { guildId } = request.params;
    const { factionId, factionName, memberRoleIds, leaderRoleIds } =
      request.body;

    if (!factionId || typeof factionId !== "number" || factionId <= 0) {
      return reply.status(400).send({ error: "Invalid faction ID." });
    }

    // Ensure target GuildConfig exists
    await db.guildConfig.upsert({
      where: { guildId },
      update: {},
      create: { guildId },
    });

    const mapping = await db.factionRoleMapping.create({
      data: {
        guildId,
        factionId,
        factionName: factionName || null,
        memberRoleIds: memberRoleIds ?? [],
        leaderRoleIds: leaderRoleIds ?? [],
        enabled: true,
      },
    });

    ipcClient.send({ action: "sync_faction_map", data: { guildId } });

    return reply.send({ success: true, mapping });
  });

  // DELETE /api/guilds/:guildId/faction-mappings/:mappingId
  fastify.delete<{ Params: { guildId: string; mappingId: string } }>(
    "/api/guilds/:guildId/faction-mappings/:mappingId",
    async (request, reply) => {
      const { guildId, mappingId } = request.params;

      await db.factionRoleMapping.delete({ where: { id: mappingId } });

      ipcClient.send({ action: "sync_faction_map", data: { guildId } });

      return reply.send({ success: true });
    },
  );

  // PUT /api/guilds/:guildId/faction-mappings/:mappingId
  fastify.put<{
    Params: { guildId: string; mappingId: string };
    Body: { memberRoleIds: string[]; leaderRoleIds: string[] };
  }>(
    "/api/guilds/:guildId/faction-mappings/:mappingId",
    async (request, reply) => {
      const { guildId, mappingId } = request.params;
      const { memberRoleIds, leaderRoleIds } = request.body;

      const updated = await db.factionRoleMapping.update({
        where: { id: mappingId },
        data: {
          memberRoleIds: memberRoleIds ?? [],
          leaderRoleIds: leaderRoleIds ?? [],
          updatedAt: new Date(),
        },
      });

      ipcClient.send({ action: "sync_faction_map", data: { guildId } });

      return reply.send({ success: true, mapping: updated });
    },
  );



  // POST /api/guilds/:guildId/api-keys
  fastify.post<{
    Params: { guildId: string };
    Body: { apiKey: string; providedBy?: string };
  }>("/api/guilds/:guildId/api-keys", async (request, reply) => {
    const { guildId } = request.params;
    const { apiKey, providedBy } = request.body;

    if (!apiKey || apiKey.trim().length !== 16) {
      return reply.status(400).send({
        error:
          "Invalid Torn API key format. Key must be a 16-character string.",
      });
    }

    const trimmedKey = apiKey.trim();

    // 1. Verify API Key with Torn API first
    let tornUserId: number | null = null;
    try {
      const profile = await tornApi.get("/user/profile", {
        apiKey: trimmedKey,
      });

      tornUserId = profile.profile.id;

      if (!tornUserId) {
        return reply.status(400).send({
          error: "Failed to extract valid Torn Player ID from Torn API key.",
        });
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Torn API verification failed.";
      return reply.status(400).send({
        error: `Torn API Verification Failed: ${errorMessage}`,
      });
    }

    // 2. Encrypt & Hash API Key
    const masterKey = process.env.ENCRYPTION_KEY || "";
    const pepper = process.env.API_KEY_HASH_PEPPER || "";
    const apiKeyEncrypted = encryptApiKey(trimmedKey, masterKey);
    const apiKeyHash = hashApiKey(trimmedKey, pepper);

    // 3. Check for duplicates in database
    const existing = await db.guildApiKey.findFirst({
      where: { apiKeyHash },
    });

    if (existing) {
      return reply
        .status(400)
        .send({ error: "This API key has already been added." });
    }

    // Ensure target GuildConfig exists
    await db.guildConfig.upsert({
      where: { guildId },
      update: {},
      create: { guildId },
    });

    // 4. Save to PostgreSQL with verified Torn Player ID
    const createdKey = await db.guildApiKey.create({
      data: {
        guildId,
        userId: tornUserId,
        apiKeyEncrypted,
        apiKeyHash,
        providedBy: providedBy || "Dashboard User",
        isValid: true,
      },
    });

    return reply.send({
      success: true,
      apiKey: {
        id: createdKey.id,
        providedBy: createdKey.providedBy,
        isValid: createdKey.isValid,
        createdAt: createdKey.createdAt,
      },
    });
  });

  // DELETE /api/guilds/:guildId/api-keys/:keyId
  fastify.delete<{ Params: { guildId: string; keyId: string } }>(
    "/api/guilds/:guildId/api-keys/:keyId",
    async (request, reply) => {
      const { keyId } = request.params;

      await db.guildApiKey.delete({
        where: { id: keyId },
      });

      return reply.send({ success: true });
    },
  );

  // GET /api/factions/:factionId
  // Resolves a faction ID to its name and tag. Checks DB first;
  // if missing or stale (>24h), fetches from Torn API and upserts.
  fastify.get<{ Params: { factionId: string } }>(
    "/api/factions/:factionId",
    async (request, reply) => {
      const factionId = parseInt(request.params.factionId, 10);

      if (isNaN(factionId) || factionId <= 0) {
        return reply.status(400).send({ error: "Invalid faction ID." });
      }

      const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

      // 1. Check DB
      const existing = await db.faction.findUnique({
        where: { id: factionId },
        select: { id: true, name: true, tag: true, updatedAt: true },
      });

      const isStale =
        !existing ||
        Date.now() - existing.updatedAt.getTime() > TWENTY_FOUR_HOURS_MS;

      if (!isStale) {
        return reply.send({
          faction: { id: existing.id, name: existing.name, tag: existing.tag },
        });
      }

      // 2. Fetch from Torn API using any available guild API key
      try {
        const anyKey = await db.guildApiKey.findFirst({
          where: { isValid: true },
          select: { apiKeyEncrypted: true },
          orderBy: { createdAt: "asc" },
        });

        if (!anyKey) {
          // No keys available — return existing stale data if we have it
          if (existing) {
            return reply.send({
              faction: { id: existing.id, name: existing.name, tag: existing.tag },
            });
          }
          return reply
            .status(404)
            .send({ error: "Faction not in database and no API keys available to fetch it." });
        }

        const { decryptApiKey } = await import("@sentinel/torn-api");
        const masterKey = process.env.ENCRYPTION_KEY || "";
        const rawKey = decryptApiKey(anyKey.apiKeyEncrypted, masterKey);

        const res = await tornApi.get("/faction/{id}/basic", {
          apiKey: rawKey,
          pathParams: { id: factionId },
        });

        const basic = res.basic;
        if (!basic) {
          if (existing) {
            return reply.send({
              faction: { id: existing.id, name: existing.name, tag: existing.tag },
            });
          }
          return reply.status(404).send({ error: "Faction not found on Torn." });
        }

        const upserted = await db.faction.upsert({
          where: { id: factionId },
          update: {
            name: basic.name ?? `Faction ${factionId}`,
            tag: basic.tag ?? null,
            tagImage: basic.tag_image ?? null,
            leaderId: basic.leader_id ?? null,
            coLeaderId: basic.co_leader_id ?? null,
            respect: basic.respect ?? 0,
            capacity: basic.capacity ?? 0,
            membersCount:
              typeof basic.members === "number" ? basic.members : 0,
            updatedAt: new Date(),
          },
          create: {
            id: factionId,
            name: basic.name ?? `Faction ${factionId}`,
            tag: basic.tag ?? null,
            tagImage: basic.tag_image ?? null,
            leaderId: basic.leader_id ?? null,
            coLeaderId: basic.co_leader_id ?? null,
            respect: basic.respect ?? 0,
            capacity: basic.capacity ?? 0,
            membersCount:
              typeof basic.members === "number" ? basic.members : 0,
          },
          select: { id: true, name: true, tag: true },
        });

        return reply.send({ faction: upserted });
      } catch (err) {
        // Fall back to stale DB record if Torn API fails
        if (existing) {
          return reply.send({
            faction: { id: existing.id, name: existing.name, tag: existing.tag },
          });
        }
        return reply.status(404).send({
          error: "Faction not found and Torn API fetch failed.",
        });
      }
    },
  );

  // GET /api/territories
  fastify.get("/api/territories", async (_request, reply) => {
    try {
      const territories = await db.territoryBlueprint.findMany({
        select: { id: true, sector: true },
        orderBy: { id: "asc" },
      });
      return reply.send({ territories });
    } catch {
      return reply.send({ territories: [] });
    }
  });

  // GET /api/guilds/:guildId/reaction-roles
  fastify.get<{ Params: { guildId: string } }>(
    "/api/guilds/:guildId/reaction-roles",
    async (request, reply) => {
      const { guildId } = request.params;
      const reactionRoleMessages = await db.reactionRoleMessage.findMany({
        where: { guildId },
        include: {
          mappings: {
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ reactionRoleMessages });
    },
  );

  // POST /api/guilds/:guildId/reaction-roles
  fastify.post<{
    Params: { guildId: string };
    Body: {
      title: string;
      channelId: string;
      requiredRoleId?: string | null;
      mappings?: { emoji: string; roleId: string; description?: string | null }[];
    };
  }>("/api/guilds/:guildId/reaction-roles", async (request, reply) => {
    const { guildId } = request.params;
    const { title, channelId, requiredRoleId, mappings = [] } = request.body;

    if (!title || !title.trim()) {
      return reply.status(400).send({ error: "Title is required." });
    }
    if (!channelId || !channelId.trim()) {
      return reply.status(400).send({ error: "Target channel is required." });
    }

    // Ensure GuildConfig exists and reaction_role module is enabled
    const existingConfig = await db.guildConfig.findUnique({ where: { guildId } });
    const currentModules = existingConfig?.enabledModules || [];
    const updatedModules = Array.from(new Set([...currentModules, "reaction_role"]));

    await db.guildConfig.upsert({
      where: { guildId },
      update: { enabledModules: updatedModules },
      create: { guildId, enabledModules: updatedModules },
    });

    const message = await db.reactionRoleMessage.create({
      data: {
        guildId,
        title: title.trim(),
        channelId: channelId.trim(),
        requiredRoleId: requiredRoleId && requiredRoleId.trim() ? requiredRoleId.trim() : null,
        mappings: {
          create: mappings.map((m) => ({
            emoji: m.emoji.trim(),
            roleId: m.roleId.trim(),
            description: m.description?.trim() || null,
          })),
        },
      },
      include: { mappings: true },
    });

    ipcClient.send({ action: "sync_reaction_roles", data: { guildId } });

    return reply.send({ success: true, message });
  });

  // PUT /api/guilds/:guildId/reaction-roles/:messageId
  fastify.put<{
    Params: { guildId: string; messageId: string };
    Body: {
      title: string;
      channelId: string;
      requiredRoleId?: string | null;
      mappings?: { emoji: string; roleId: string; description?: string | null }[];
    };
  }>("/api/guilds/:guildId/reaction-roles/:messageId", async (request, reply) => {
    const { guildId, messageId } = request.params;
    const { title, channelId, requiredRoleId, mappings = [] } = request.body;

    if (!title || !title.trim()) {
      return reply.status(400).send({ error: "Title is required." });
    }
    if (!channelId || !channelId.trim()) {
      return reply.status(400).send({ error: "Target channel is required." });
    }

    // Ensure reaction_role module is enabled
    const existingConfig = await db.guildConfig.findUnique({ where: { guildId } });
    const currentModules = existingConfig?.enabledModules || [];
    if (!currentModules.includes("reaction_role")) {
      const updatedModules = Array.from(new Set([...currentModules, "reaction_role"]));
      await db.guildConfig.upsert({
        where: { guildId },
        update: { enabledModules: updatedModules },
        create: { guildId, enabledModules: updatedModules },
      });
    }

    // Replace mappings in transaction
    await db.reactionRoleMapping.deleteMany({
      where: { messageId },
    });

    const updated = await db.reactionRoleMessage.update({
      where: { id: messageId },
      data: {
        title: title.trim(),
        channelId: channelId.trim(),
        requiredRoleId: requiredRoleId && requiredRoleId.trim() ? requiredRoleId.trim() : null,
        updatedAt: new Date(),
        mappings: {
          create: mappings.map((m) => ({
            emoji: m.emoji.trim(),
            roleId: m.roleId.trim(),
            description: m.description?.trim() || null,
          })),
        },
      },
      include: { mappings: true },
    });

    ipcClient.send({ action: "sync_reaction_roles", data: { guildId } });

    return reply.send({ success: true, message: updated });
  });

  // DELETE /api/guilds/:guildId/reaction-roles/:messageId
  fastify.delete<{ Params: { guildId: string; messageId: string } }>(
    "/api/guilds/:guildId/reaction-roles/:messageId",
    async (request, reply) => {
      const { guildId, messageId } = request.params;
      const existing = await db.reactionRoleMessage.findUnique({
        where: { id: messageId },
      });

      if (existing?.messageId && existing?.channelId) {
        const botToken = process.env.DISCORD_BOT_TOKEN;
        if (botToken) {
          try {
            await fetch(
              `https://discord.com/api/v10/channels/${existing.channelId}/messages/${existing.messageId}`,
              {
                method: "DELETE",
                headers: { Authorization: `Bot ${botToken}` },
              },
            );
          } catch {
            // Ignore if Discord message deletion fails or already deleted
          }
        }
      }

      await db.reactionRoleMessage.delete({
        where: { id: messageId },
      });

      ipcClient.send({ action: "sync_reaction_roles", data: { guildId } });

      return reply.send({ success: true });
    },
  );
}





