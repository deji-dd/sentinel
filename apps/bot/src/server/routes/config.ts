import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../lib/db-client.js";
import {
  getGuildApiKeys,
  storeGuildApiKey,
  getPrimaryGuildApiKey,
} from "../../lib/guild-api-keys.js";
import { validateAndFetchFactionDetails } from "../../lib/faction-utils.js";
import { validateTornApiKey } from "../../services/torn-client.js";
import { logGuildSuccess, logGuildAction } from "../../lib/guild-logger.js";
import { getServerContext } from "../context.js";

export const configRouter = Router();

configRouter.get("/", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService, discordClient } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session || !session.guild_id)
      return res.status(401).json({ error: "Invalid or expired session" });

    const guildId = session.guild_id;

    let guildInfo = {
      name: "Unknown Guild",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      channels: [] as any[],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      roles: [] as any[],
    };
    try {
      const guild = await discordClient.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();
      const roles = await guild.roles.fetch();

      guildInfo = {
        name: guild.name,
        channels: Array.from(channels.values())
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((c: any) => c && c.isTextBased())
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((c: any) => ({ id: c.id, name: c.name })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        roles: Array.from(roles.values()).map((r: any) => ({
          id: r.id,
          name: r.name,
        })),
      };
    } catch (err) {
      console.error(`[HTTP] Failed to fetch guild info for ${guildId}:`, err);
    }

    // Get main config
    const config = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!config) {
      // Create default config if missing
      await db
        .insertInto(TABLE_NAMES.GUILD_CONFIG)
        .values({
          guild_id: guildId,
          enabled_modules: JSON.stringify(["admin"]),
          admin_role_ids: JSON.stringify([]),
        })
        .execute();

      return res.json({
        guild_id: guildId,
        enabled_modules: ["admin"],
        admin_role_ids: [],
        api_keys: [],
      });
    }

    // Get API keys (masked)
    const keys = await db
      .selectFrom(TABLE_NAMES.GUILD_API_KEYS)
      .select([
        "id",
        "provided_by",
        "is_primary",
        "invalid_count",
        "created_at",
      ])
      .where("guild_id", "=", guildId)
      .where("deleted_at", "is", null)
      .execute();

    // Resolve provided_by usernames
    const keysWithNames = await Promise.all(
      keys.map(async (key) => {
        try {
          const user = await discordClient.users.fetch(key.provided_by);
          return {
            ...key,
            provided_by_name:
              user?.globalName || user?.username || key.provided_by,
          };
        } catch {
          return { ...key, provided_by_name: key.provided_by };
        }
      }),
    );

    res.json({
      ...config,
      guild_name: guildInfo.name,
      channels: guildInfo.channels,
      roles: guildInfo.roles,
      enabled_modules:
        typeof config.enabled_modules === "string"
          ? JSON.parse(config.enabled_modules)
          : config.enabled_modules,
      admin_role_ids:
        typeof config.admin_role_ids === "string"
          ? JSON.parse(config.admin_role_ids)
          : config.admin_role_ids,
      verified_role_ids:
        typeof config.verified_role_ids === "string"
          ? JSON.parse(config.verified_role_ids)
          : config.verified_role_ids || [],
      api_keys: keysWithNames,
    });
  } catch (error) {
    console.error("[HTTP] Error fetching config:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.post("/", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService, discordClient } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session || !session.guild_id)
      return res.status(401).json({ error: "Invalid or expired session" });

    const guildId = session.guild_id;
    const {
      log_channel_id,
      admin_role_ids,
      nickname_template,
      enabled_modules,
      auto_verify,
    } = req.body;

    // Get current config to compare
    const currentConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    const changes: string[] = [];

    if (
      log_channel_id !== undefined &&
      log_channel_id !== currentConfig?.log_channel_id
    ) {
      updateData.log_channel_id = log_channel_id;
      changes.push("Log Channel");
    }

    if (admin_role_ids !== undefined) {
      const newRolesStr = JSON.stringify(admin_role_ids);
      if (newRolesStr !== currentConfig?.admin_role_ids) {
        updateData.admin_role_ids = newRolesStr;
        changes.push("Admin Roles");
      }
    }

    if (
      nickname_template !== undefined &&
      nickname_template !== currentConfig?.nickname_template
    ) {
      updateData.nickname_template = nickname_template;
      changes.push("Nickname Template");
    }

    if (enabled_modules !== undefined) {
      const newModulesStr = JSON.stringify(enabled_modules);
      if (newModulesStr !== currentConfig?.enabled_modules) {
        updateData.enabled_modules = newModulesStr;
        changes.push("Modules");
      }
    }

    if (auto_verify !== undefined) {
      const newVal = auto_verify ? 1 : 0;
      if (newVal !== currentConfig?.auto_verify) {
        updateData.auto_verify = newVal;
        changes.push("Auto-Verify");
      }
    }

    if (
      req.body.verified_role_id !== undefined &&
      req.body.verified_role_id !== currentConfig?.verified_role_id
    ) {
      updateData.verified_role_id = req.body.verified_role_id;
      changes.push("Verified Role");
    }

    if (req.body.verified_role_ids !== undefined) {
      const newIdsStr = JSON.stringify(req.body.verified_role_ids);
      if (newIdsStr !== currentConfig?.verified_role_ids) {
        updateData.verified_role_ids = newIdsStr;
        changes.push("Verified Roles");
      }
    }

    if (
      req.body.faction_list_channel_id !== undefined &&
      req.body.faction_list_channel_id !==
        currentConfig?.faction_list_channel_id
    ) {
      updateData.faction_list_channel_id = req.body.faction_list_channel_id;
      changes.push("Faction List Channel");
    }

    if (changes.length > 0) {
      await db
        .updateTable(TABLE_NAMES.GUILD_CONFIG)
        .set(updateData)
        .where("guild_id", "=", guildId)
        .execute();

      // Log the change
      await logGuildSuccess(
        guildId,
        discordClient,
        "System Configuration Updated",
        `<@${session.discord_id}> updated the guild configuration via Web Dashboard.`,
        [
          {
            name: "Updated Settings",
            value: changes.join(", "),
            inline: false,
          },
        ],
      );
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("[HTTP] Error updating config:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.get("/faction-lookup/:factionId", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session || !session.guild_id)
      return res.status(401).json({ error: "Invalid or expired session" });

    const { factionId } = req.params;
    const guildId = session.guild_id;

    // Get primary API key for this guild to perform the lookup
    const apiKey = await getPrimaryGuildApiKey(guildId);
    if (!apiKey) {
      return res.status(400).json({
        error:
          "No primary API key configured. Please set a primary API key in the Security tab first.",
      });
    }

    const faction = await validateAndFetchFactionDetails(
      Number.parseInt(factionId as string),
      apiKey as string,
    );
    if (!faction) {
      return res
        .status(404)
        .json({ error: "Faction not found or Torn API error" });
    }

    res.json(faction);
  } catch (error) {
    console.error("[HTTP] Error looking up faction:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.get("/faction-roles", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session || !session.guild_id)
      return res.status(401).json({ error: "Invalid or expired session" });

    const roles = await db
      .selectFrom(TABLE_NAMES.FACTION_ROLES)
      .selectAll()
      .where("guild_id", "=", session.guild_id)
      .execute();

    res.json(
      roles.map((r) => ({
        ...r,
        member_role_ids:
          typeof r.member_role_ids === "string"
            ? JSON.parse(r.member_role_ids)
            : r.member_role_ids,
        leader_role_ids:
          typeof r.leader_role_ids === "string"
            ? JSON.parse(r.leader_role_ids)
            : r.leader_role_ids,
      })),
    );
  } catch (error) {
    console.error("[HTTP] Error fetching faction roles:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.post("/faction-roles", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService, discordClient } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session || !session.guild_id)
      return res.status(401).json({ error: "Invalid or expired session" });

    const {
      id,
      faction_id,
      faction_name,
      member_role_ids,
      leader_role_ids,
      enabled,
    } = req.body;

    if (!faction_id)
      return res.status(400).json({ error: "Missing faction_id" });

    const roleData = {
      guild_id: session.guild_id,
      faction_id: Number.parseInt(faction_id),
      faction_name: faction_name || null,
      member_role_ids: JSON.stringify(member_role_ids || []),
      leader_role_ids: JSON.stringify(leader_role_ids || []),
      enabled: enabled ? 1 : 0,
      updated_at: new Date().toISOString(),
    };

    if (id) {
      // Update existing
      await db
        .updateTable(TABLE_NAMES.FACTION_ROLES)
        .set(roleData)
        .where("id", "=", id)
        .where("guild_id", "=", session.guild_id)
        .execute();
    } else {
      // Insert new
      await db
        .insertInto(TABLE_NAMES.FACTION_ROLES)
        .values({
          ...roleData,
          id: randomUUID(),
          created_at: new Date().toISOString(),
        })
        .execute();
    }

    await logGuildAction(session.guild_id, discordClient, {
      title: "Faction Role Mapping Updated",
      description: `<@${session.discord_id}> updated faction role mapping for faction ${faction_id} via Web Dashboard.`,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("[HTTP] Error saving faction role:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.delete(
  "/faction-roles/:id",
  async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    const { magicLinkService, discordClient } = getServerContext(req);

    try {
      const session = await magicLinkService.validateSession(token, "config");
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const { id } = req.params;

      await db
        .deleteFrom(TABLE_NAMES.FACTION_ROLES)
        .where("id", "=", id)
        .where("guild_id", "=", session.guild_id)
        .execute();

      await logGuildAction(session.guild_id, discordClient, {
        title: "Faction Role Mapping Deleted",
        description: `<@${session.discord_id}> deleted a faction role mapping via Web Dashboard.`,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error("[HTTP] Error deleting faction role:", error);
      res.status(500).json({ error: "Server error" });
    }
  },
);

configRouter.post("/api-keys", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService, discordClient } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token);
    if (!session || !session.guild_id)
      return res.status(401).json({ error: "Invalid or expired session" });

    const { api_key, is_primary } = req.body;
    if (!api_key) return res.status(400).json({ error: "API key is required" });

    // Check current key count
    const existingKeys = await getGuildApiKeys(session.guild_id);
    if (existingKeys.length >= 5) {
      return res.status(400).json({ error: "Maximum of 5 API keys per guild" });
    }

    // Verification guard: Fetch key info to ensure it's valid and get the Torn ID
    let keyInfo;
    try {
      keyInfo = await validateTornApiKey(api_key);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      return res.status(400).json({
        error: `API Key Validation Failed: ${err.message}`,
      });
    }

    const primaryBool = !!is_primary;
    await storeGuildApiKey(
      session.guild_id,
      api_key,
      keyInfo.playerId,
      session.discord_id,
      primaryBool,
    );

    // Log the addition (mask the key)
    const maskedKey = `...${api_key.slice(-4)}`;
    await logGuildSuccess(
      session.guild_id,
      discordClient,
      "API Key Added",
      `<@${session.discord_id}> added a new Torn API key (${maskedKey}) via Web Dashboard.`,
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("[HTTP] Error storing API key:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.delete("/api-keys", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService, discordClient } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token);
    if (!session || !session.guild_id)
      return res.status(401).json({ error: "Invalid or expired session" });

    const { api_key_id } = req.body;
    if (!api_key_id)
      return res.status(400).json({ error: "API key ID is required" });

    const keyRecord = await db
      .selectFrom(TABLE_NAMES.GUILD_API_KEYS)
      .selectAll()
      .where("id", "=", api_key_id)
      .where("guild_id", "=", session.guild_id)
      .executeTakeFirst();

    await db
      .updateTable(TABLE_NAMES.GUILD_API_KEYS)
      .set({ deleted_at: new Date().toISOString() })
      .where("id", "=", api_key_id)
      .where("guild_id", "=", session.guild_id)
      .execute();

    // Log the removal
    if (keyRecord) {
      let ownerLabel = keyRecord.provided_by || "Unknown";
      try {
        const owner = await discordClient.users.fetch(keyRecord.provided_by);
        ownerLabel =
          owner?.globalName || owner?.username || keyRecord.provided_by;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        // Fallback to mention if resolution fails
        ownerLabel = `<@${keyRecord.provided_by}>`;
      }

      await logGuildAction(session.guild_id, discordClient, {
        title: "API Key Removed",
        description: `<@${session.discord_id}> removed a Torn API key via Web Dashboard.`,
        color: 0xef4444,
        fields: [
          {
            name: "Owned By",
            value: ownerLabel,
            inline: true,
          },
        ],
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("[HTTP] Error deleting API key:", error);
    res.status(500).json({ error: "Server error" });
  }
});
