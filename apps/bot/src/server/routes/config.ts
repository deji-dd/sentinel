import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { EmbedBuilder } from "discord.js";
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

type GuildInfoSummary = {
  name: string;
  channels: Array<{ id: string; name: string }>;
  roles: Array<{ id: string; name: string }>;
};

function parseJsonArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item));
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
    } catch {
      return [];
    }
  }

  return [];
}

async function getFactionWarState(factionId: number): Promise<{
  hasActiveWar: boolean;
  hasUpcomingWar: boolean;
}> {
  const nowIso = new Date().toISOString();

  const wars = await db
    .selectFrom(TABLE_NAMES.WAR_LEDGER)
    .select(["start_time", "end_time"])
    .where((eb) =>
      eb.or([
        eb("assaulting_faction", "=", factionId),
        eb("defending_faction", "=", factionId),
      ]),
    )
    .where((eb) =>
      eb.or([
        eb("end_time", "is", null),
        eb("end_time", ">", nowIso),
        eb("start_time", ">", nowIso),
      ]),
    )
    .limit(25)
    .execute();

  let hasActiveWar = false;
  let hasUpcomingWar = false;

  for (const war of wars) {
    const start = war.start_time;
    const end = war.end_time;

    if (start > nowIso) {
      hasUpcomingWar = true;
      continue;
    }

    if (!end || end > nowIso) {
      hasActiveWar = true;
    }
  }

  return { hasActiveWar, hasUpcomingWar };
}

function normalizeMercenaryContractRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
) {
  return {
    ...row,
    target_roles: parseJsonArray(row.target_roles_json),
  };
}

configRouter.get("/mercenary", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session || !session.guild_id)
      return res.status(401).json({ error: "Invalid or expired session" });

    const guildId = session.guild_id;

    const settings = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    const contracts = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
      .selectAll()
      .where("guild_id", "=", guildId)
      .orderBy("created_at", "desc")
      .execute();

    const normalizedContracts = contracts.map(normalizeMercenaryContractRow);

    const activeContracts = normalizedContracts.filter((contract) =>
      ["active", "paused"].includes(contract.status),
    );

    const pastContracts = normalizedContracts.filter(
      (contract) => !["active", "paused"].includes(contract.status),
    );

    res.json({
      settings: {
        guild_id: guildId,
        is_enabled: settings?.is_enabled ?? 0,
        contract_announcement_channel_id:
          settings?.contract_announcement_channel_id ?? null,
        hit_post_channel_id: settings?.hit_post_channel_id ?? null,
        payout_channel_id: settings?.payout_channel_id ?? null,
        audit_channel_id: settings?.audit_channel_id ?? null,
        default_target_scope: settings?.default_target_scope ?? "all_members",
        default_idle_minutes: settings?.default_idle_minutes ?? null,
        default_auto_finish_on_war_end:
          settings?.default_auto_finish_on_war_end ?? 0,
      },
      active_contracts: activeContracts,
      past_contracts: pastContracts,
    });
  } catch (error) {
    console.error("[HTTP] Error fetching mercenary config:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.post(
  "/mercenary/settings",
  async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    const { magicLinkService, discordClient } = getServerContext(req);

    try {
      const session = await magicLinkService.validateSession(token, "config");
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const guildId = session.guild_id;
      const now = new Date().toISOString();

      const {
        is_enabled,
        contract_announcement_channel_id,
        hit_post_channel_id,
        payout_channel_id,
        audit_channel_id,
        default_target_scope,
        default_idle_minutes,
        default_auto_finish_on_war_end,
      } = req.body;

      await db
        .insertInto(TABLE_NAMES.MERCENARY_CONFIG)
        .values({
          guild_id: guildId,
          is_enabled: is_enabled ? 1 : 0,
          contract_announcement_channel_id:
            contract_announcement_channel_id || null,
          hit_post_channel_id: hit_post_channel_id || null,
          payout_channel_id: payout_channel_id || null,
          audit_channel_id: audit_channel_id || null,
          default_target_scope: default_target_scope || "all_members",
          default_idle_minutes: default_idle_minutes
            ? Number(default_idle_minutes)
            : null,
          default_auto_finish_on_war_end: default_auto_finish_on_war_end
            ? 1
            : 0,
          updated_by: session.discord_id,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.column("guild_id").doUpdateSet({
            is_enabled: is_enabled ? 1 : 0,
            contract_announcement_channel_id:
              contract_announcement_channel_id || null,
            hit_post_channel_id: hit_post_channel_id || null,
            payout_channel_id: payout_channel_id || null,
            audit_channel_id: audit_channel_id || null,
            default_target_scope: default_target_scope || "all_members",
            default_idle_minutes: default_idle_minutes
              ? Number(default_idle_minutes)
              : null,
            default_auto_finish_on_war_end: default_auto_finish_on_war_end
              ? 1
              : 0,
            updated_by: session.discord_id,
            updated_at: now,
          }),
        )
        .execute();

      await logGuildAction(guildId, discordClient, {
        title: "Mercenary Module Settings Updated",
        description: `<@${session.discord_id}> updated mercenary module settings via Web Dashboard.`,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error("[HTTP] Error saving mercenary settings:", error);
      res.status(500).json({ error: "Server error" });
    }
  },
);

configRouter.post(
  "/mercenary/contracts",
  async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    const { magicLinkService, discordClient } = getServerContext(req);

    try {
      const session = await magicLinkService.validateSession(token, "config");
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const guildId = session.guild_id;
      const {
        title,
        description,
        contract_type,
        pay_amount,
        pay_currency,
        pay_terms,
        status,
        start_at,
        ends_at,
        faction_id,
        target_scope,
        idle_minutes,
        auto_finish_on_war_end,
        min_level,
        max_level,
        target_roles,
        require_faction_no_active_war,
        require_faction_no_upcoming_war,
      } = req.body;

      if (!title || String(title).trim().length === 0) {
        return res.status(400).json({ error: "Contract title is required" });
      }

      const factionIdNumber = Number(faction_id);
      if (!Number.isInteger(factionIdNumber) || factionIdNumber <= 0) {
        return res.status(400).json({ error: "Valid faction_id is required" });
      }

      const apiKey = await getPrimaryGuildApiKey(guildId);
      if (!apiKey) {
        return res.status(400).json({
          error:
            "No primary API key configured. Add one in Admin Config before creating contracts.",
        });
      }

      const faction = await validateAndFetchFactionDetails(
        factionIdNumber,
        apiKey,
      );
      if (!faction) {
        return res.status(400).json({
          error:
            "Faction verification failed. Check faction_id and API key scope.",
        });
      }

      const warState = await getFactionWarState(factionIdNumber);
      if (warState.hasActiveWar || warState.hasUpcomingWar) {
        return res.status(400).json({
          error:
            "Faction has an active or upcoming war. Contract cannot be opened until this is clear.",
          war_state: warState,
        });
      }

      const requiresNoActiveWar = require_faction_no_active_war ? 1 : 0;
      const requiresNoUpcomingWar = require_faction_no_upcoming_war ? 1 : 0;

      if (requiresNoActiveWar && warState.hasActiveWar) {
        return res.status(400).json({
          error: "Faction currently has an active war.",
        });
      }

      if (requiresNoUpcomingWar && warState.hasUpcomingWar) {
        return res.status(400).json({
          error: "Faction has an upcoming war.",
        });
      }

      const now = new Date().toISOString();
      const contractId = randomUUID();

      await db
        .insertInto(TABLE_NAMES.MERCENARY_CONTRACTS)
        .values({
          id: contractId,
          guild_id: guildId,
          title: String(title).trim(),
          description: description || null,
          contract_type: contract_type || "hit",
          status: status || "active",
          pay_amount: Number(pay_amount) || 0,
          pay_currency: pay_currency || "cash",
          pay_terms: pay_terms || null,
          start_at: start_at || null,
          ends_at: ends_at || null,
          created_by: session.discord_id,
          updated_at: now,
          faction_id: factionIdNumber,
          faction_name: faction.name,
          target_scope: target_scope || "all_members",
          idle_minutes: idle_minutes ? Number(idle_minutes) : null,
          auto_finish_on_war_end: auto_finish_on_war_end ? 1 : 0,
          min_level: min_level ? Number(min_level) : null,
          max_level: max_level ? Number(max_level) : null,
          target_roles_json: JSON.stringify(
            Array.isArray(target_roles) ? target_roles : [],
          ),
          require_faction_no_active_war: requiresNoActiveWar,
          require_faction_no_upcoming_war: requiresNoUpcomingWar,
        })
        .execute();

      await logGuildAction(guildId, discordClient, {
        title: "Mercenary Contract Created",
        description: `<@${session.discord_id}> created contract **${String(title).trim()}** for faction **${faction.name}**.`,
      });

      const createdContract = await db
        .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
        .selectAll()
        .where("id", "=", contractId)
        .executeTakeFirst();

      res.json({
        ok: true,
        contract: createdContract
          ? normalizeMercenaryContractRow(createdContract)
          : null,
      });
    } catch (error) {
      console.error("[HTTP] Error creating mercenary contract:", error);
      res.status(500).json({ error: "Server error" });
    }
  },
);

configRouter.patch(
  "/mercenary/contracts/:id",
  async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    const { magicLinkService, discordClient } = getServerContext(req);

    try {
      const session = await magicLinkService.validateSession(token, "config");
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const guildId = session.guild_id;
      const contractId = req.params.id;
      const existing = await db
        .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
        .selectAll()
        .where("id", "=", contractId)
        .where("guild_id", "=", guildId)
        .executeTakeFirst();

      if (!existing) {
        return res.status(404).json({ error: "Contract not found" });
      }

      const nextFactionId = req.body.faction_id
        ? Number(req.body.faction_id)
        : existing.faction_id;

      if (!nextFactionId || !Number.isInteger(nextFactionId)) {
        return res.status(400).json({ error: "Valid faction_id is required" });
      }

      const apiKey = await getPrimaryGuildApiKey(guildId);
      if (!apiKey) {
        return res.status(400).json({
          error:
            "No primary API key configured. Add one in Admin Config before updating contracts.",
        });
      }

      const faction = await validateAndFetchFactionDetails(
        nextFactionId,
        apiKey,
      );
      if (!faction) {
        return res.status(400).json({
          error:
            "Faction verification failed. Check faction_id and API key scope.",
        });
      }

      const warState = await getFactionWarState(nextFactionId);
      if (warState.hasActiveWar || warState.hasUpcomingWar) {
        return res.status(400).json({
          error:
            "Faction has an active or upcoming war. Contract cannot be updated to this faction yet.",
          war_state: warState,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {
        updated_at: new Date().toISOString(),
        faction_id: nextFactionId,
        faction_name: faction.name,
      };

      if (req.body.title !== undefined) {
        updateData.title = String(req.body.title).trim();
      }
      if (req.body.description !== undefined) {
        updateData.description = req.body.description || null;
      }
      if (req.body.contract_type !== undefined) {
        updateData.contract_type = req.body.contract_type;
      }
      if (req.body.pay_amount !== undefined) {
        updateData.pay_amount = Number(req.body.pay_amount) || 0;
      }
      if (req.body.pay_currency !== undefined) {
        updateData.pay_currency = req.body.pay_currency;
      }
      if (req.body.pay_terms !== undefined) {
        updateData.pay_terms = req.body.pay_terms || null;
      }
      if (req.body.start_at !== undefined) {
        updateData.start_at = req.body.start_at || null;
      }
      if (req.body.ends_at !== undefined) {
        updateData.ends_at = req.body.ends_at || null;
      }
      if (req.body.target_scope !== undefined) {
        updateData.target_scope = req.body.target_scope;
      }
      if (req.body.idle_minutes !== undefined) {
        updateData.idle_minutes = req.body.idle_minutes
          ? Number(req.body.idle_minutes)
          : null;
      }
      if (req.body.auto_finish_on_war_end !== undefined) {
        updateData.auto_finish_on_war_end = req.body.auto_finish_on_war_end
          ? 1
          : 0;
      }
      if (req.body.min_level !== undefined) {
        updateData.min_level = req.body.min_level
          ? Number(req.body.min_level)
          : null;
      }
      if (req.body.max_level !== undefined) {
        updateData.max_level = req.body.max_level
          ? Number(req.body.max_level)
          : null;
      }
      if (req.body.target_roles !== undefined) {
        updateData.target_roles_json = JSON.stringify(
          Array.isArray(req.body.target_roles) ? req.body.target_roles : [],
        );
      }
      if (req.body.require_faction_no_active_war !== undefined) {
        updateData.require_faction_no_active_war = req.body
          .require_faction_no_active_war
          ? 1
          : 0;
      }
      if (req.body.require_faction_no_upcoming_war !== undefined) {
        updateData.require_faction_no_upcoming_war = req.body
          .require_faction_no_upcoming_war
          ? 1
          : 0;
      }
      if (req.body.status !== undefined) {
        updateData.status = req.body.status;
        if (["completed", "cancelled", "closed"].includes(req.body.status)) {
          updateData.closed_at = new Date().toISOString();
        }
      }

      await db
        .updateTable(TABLE_NAMES.MERCENARY_CONTRACTS)
        .set(updateData)
        .where("id", "=", contractId)
        .where("guild_id", "=", guildId)
        .execute();

      await logGuildAction(guildId, discordClient, {
        title: "Mercenary Contract Updated",
        description: `<@${session.discord_id}> updated contract **${existing.title}**.`,
      });

      const updatedContract = await db
        .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
        .selectAll()
        .where("id", "=", contractId)
        .where("guild_id", "=", guildId)
        .executeTakeFirst();

      res.json({
        ok: true,
        contract: updatedContract
          ? normalizeMercenaryContractRow(updatedContract)
          : null,
      });
    } catch (error) {
      console.error("[HTTP] Error updating mercenary contract:", error);
      res.status(500).json({ error: "Server error" });
    }
  },
);

configRouter.get("/", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService, discordClient } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session || !session.guild_id)
      return res.status(401).json({ error: "Invalid or expired session" });

    const guildId = session.guild_id;

    let guildInfo: GuildInfoSummary = {
      name: "Unknown Guild",
      channels: [],
      roles: [],
    };
    try {
      const guild = await discordClient.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();
      const roles = await guild.roles.fetch();

      guildInfo = {
        name: guild.name,
        channels: Array.from(channels.values()).flatMap((channel) => {
          if (!channel || !channel.isTextBased()) {
            return [];
          }

          const maybeNamedChannel = channel as { name?: unknown; id: string };
          const name =
            typeof maybeNamedChannel.name === "string"
              ? maybeNamedChannel.name
              : maybeNamedChannel.id;
          return [{ id: channel.id, name }];
        }),
        roles: Array.from(roles.values()).flatMap((role) => {
          if (!role) {
            return [];
          }
          return [{ id: role.id, name: role.name }];
        }),
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

    const adminGuildId = process.env.ADMIN_GUILD_ID;
    const isAdminGuild = guildId === adminGuildId;

    res.json({
      ...config,
      guild_name: guildInfo.name,
      available_channels: guildInfo.channels,
      available_roles: guildInfo.roles,
      enabled_modules:
        typeof config.enabled_modules === "string"
          ? JSON.parse(config.enabled_modules)
          : config.enabled_modules || [],
      admin_role_ids:
        typeof config.admin_role_ids === "string"
          ? JSON.parse(config.admin_role_ids)
          : config.admin_role_ids || [],
      verified_role_ids:
        typeof config.verified_role_ids === "string"
          ? JSON.parse(config.verified_role_ids)
          : config.verified_role_ids || [],
      tt_territory_ids:
        typeof config.tt_territory_ids === "string"
          ? JSON.parse(config.tt_territory_ids)
          : config.tt_territory_ids || [],
      tt_faction_ids:
        typeof config.tt_faction_ids === "string"
          ? JSON.parse(config.tt_faction_ids)
          : config.tt_faction_ids || [],
      api_keys: keysWithNames,
      is_admin_guild: isAdminGuild,
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

    if (
      req.body.tt_full_channel_id !== undefined &&
      req.body.tt_full_channel_id !== currentConfig?.tt_full_channel_id
    ) {
      updateData.tt_full_channel_id = req.body.tt_full_channel_id;
      changes.push("TT Full Notification Channel");
    }

    if (
      req.body.tt_filtered_channel_id !== undefined &&
      req.body.tt_filtered_channel_id !== currentConfig?.tt_filtered_channel_id
    ) {
      updateData.tt_filtered_channel_id = req.body.tt_filtered_channel_id;
      changes.push("TT Filtered Notification Channel");
    }

    if (req.body.tt_territory_ids !== undefined) {
      const newIdsStr = JSON.stringify(req.body.tt_territory_ids);
      if (newIdsStr !== currentConfig?.tt_territory_ids) {
        updateData.tt_territory_ids = newIdsStr;
        changes.push("TT Filtered Territories");
      }
    }

    if (req.body.tt_faction_ids !== undefined) {
      const newIdsStr = JSON.stringify(req.body.tt_faction_ids);
      if (newIdsStr !== currentConfig?.tt_faction_ids) {
        updateData.tt_faction_ids = newIdsStr;
        changes.push("TT Filtered Factions");
      }
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

configRouter.get("/reaction-roles", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session || !session.guild_id)
      return res.status(401).json({ error: "Invalid or expired session" });

    const messages = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("guild_id", "=", session.guild_id)
      .orderBy("created_at", "desc")
      .execute();

    const result = [];
    for (const msg of messages) {
      const mappings = await db
        .selectFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
        .selectAll()
        .where("message_id", "=", msg.message_id)
        .execute();

      result.push({
        ...msg,
        mappings: mappings.map((m) => ({
          id: m.id,
          emoji: m.emoji,
          role_id: m.role_id,
        })),
      });
    }

    res.json(result);
  } catch (error) {
    console.error("[HTTP] Error fetching reaction roles:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.post("/reaction-roles", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService, discordClient } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session || !session.guild_id)
      return res.status(401).json({ error: "Invalid or expired session" });

    const {
      channel_id,
      title,
      description,
      required_role_id,
      sync_roles,
      mappings,
    } = req.body;

    if (!channel_id || !mappings || mappings.length === 0) {
      return res.status(400).json({ error: "Missing channel or mappings" });
    }

    const channel = await discordClient.channels
      .fetch(channel_id)
      .catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return res.status(400).json({ error: "Invalid or inaccessible channel" });
    }

    let finalDescription =
      description || "React with the emojis below to assign yourself roles:";
    finalDescription += "\n\n";
    for (const mapping of mappings) {
      finalDescription += `${mapping.emoji} → <@&${mapping.role_id}>\n`;
    }

    if (required_role_id) {
      finalDescription += `\n*Note: You must have the <@&${required_role_id}> role to use these reactions.*`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle(title || "Reaction Roles")
      .setDescription(finalDescription);

    const postedMessage = await channel.send({ embeds: [embed] });

    for (const mapping of mappings) {
      try {
        await postedMessage.react(mapping.emoji);
      } catch (e) {
        console.warn(`Failed to add reaction ${mapping.emoji}:`, e);
      }
    }

    const messageRecord = await db
      .insertInto(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .values({
        guild_id: session.guild_id,
        channel_id: channel_id,
        message_id: postedMessage.id,
        title: title || "Reaction Roles",
        description: description || null,
        required_role_id: required_role_id || null,
        sync_roles: sync_roles ? 1 : 0,
        created_at: new Date().toISOString(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    for (const mapping of mappings) {
      await db
        .insertInto(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
        .values({
          id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
          message_id: postedMessage.id,
          emoji: mapping.emoji,
          role_id: mapping.role_id,
          created_at: new Date().toISOString(),
        })
        .execute();
    }

    await logGuildAction(session.guild_id, discordClient, {
      title: "Reaction Role Message Created",
      description: `<@${session.discord_id}> created a new reaction role message in <#${channel_id}> via Web Dashboard.`,
    });

    res.json({ ok: true, message: messageRecord });
  } catch (error) {
    console.error("[HTTP] Error creating reaction role message:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.patch(
  "/reaction-roles/:id",
  async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    const { magicLinkService, discordClient } = getServerContext(req);
    const { title, description, required_role_id, sync_roles, mappings } =
      req.body;

    try {
      const session = await magicLinkService.validateSession(token, "config");
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const msgId = Number.parseInt(req.params.id as string);

      // 1. Fetch existing record to find Discord message
      const existing = await db
        .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
        .selectAll()
        .where("id", "=", msgId)
        .where("guild_id", "=", session.guild_id)
        .executeTakeFirst();

      if (!existing)
        return res.status(404).json({ error: "Message not found" });

      // 2. Build new Discord Embed
      let finalDescription = description || "";
      if (!description && mappings?.length > 0) {
        for (const mapping of mappings) {
          finalDescription += `${mapping.emoji} → <@&${mapping.role_id}>\n`;
        }
      }
      if (required_role_id) {
        const roles = required_role_id.split(",");
        finalDescription += `\n*Note: You must have at least one of these roles to use these reactions: ${roles.map((r: string) => `<@&${r}>`).join(", ")}*`;
      }

      const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(title || "Reaction Roles")
        .setDescription(finalDescription);

      // 3. Update Discord message
      try {
        const channel = await discordClient.channels.fetch(existing.channel_id);
        if (channel && channel.isTextBased()) {
          const discordMsg = await channel.messages.fetch(existing.message_id);
          if (discordMsg) {
            await discordMsg.edit({ embeds: [embed] });

            // If mappings changed, we update reactions. Safe approach: add new ones, ignore old.
            // For a truly clean experience, we'd clear and re-add if emojis changed.
            // Let's check if emojis changed.
            const oldMappings = await db
              .selectFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
              .select("emoji")
              .where("message_id", "=", existing.message_id)
              .execute();
            const oldEmojis = oldMappings.map((m) => m.emoji);
            const newEmojis = mappings.map((m: { emoji: string }) => m.emoji);

            const emojisChanged =
              JSON.stringify(oldEmojis.sort()) !==
              JSON.stringify(newEmojis.sort());

            if (emojisChanged) {
              // Too risky to remove all if people have already reacted.
              // We'll just ensure all NEW ones are there.
              for (const emoji of newEmojis) {
                if (!oldEmojis.includes(emoji)) {
                  try {
                    await discordMsg.react(emoji);
                  } catch (e) {
                    console.warn(
                      `Failed to react with ${emoji} while updating:`,
                      e,
                    );
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn("Failed to update discord message embed:", e);
      }

      // 4. Update DB
      await db
        .updateTable(TABLE_NAMES.REACTION_ROLE_MESSAGES)
        .set({
          title: title || "Reaction Roles",
          description: description || null,
          required_role_id: required_role_id || null,
          sync_roles: sync_roles ? 1 : 0,
          updated_at: new Date().toISOString(),
        })
        .where("id", "=", msgId)
        .execute();

      // 5. Update Mappings (delete and reinstall)
      await db
        .deleteFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
        .where("message_id", "=", existing.message_id)
        .execute();

      for (const mapping of mappings) {
        await db
          .insertInto(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
          .values({
            id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
            message_id: existing.message_id,
            emoji: mapping.emoji,
            role_id: mapping.role_id,
            created_at: new Date().toISOString(),
          })
          .execute();
      }

      await logGuildAction(session.guild_id, discordClient, {
        title: "Reaction Role Message Updated",
        description: `<@${session.discord_id}> updated a reaction role message in <#${existing.channel_id}> via Web Dashboard.`,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error(
        "[HTTP] Catch-all error updating reaction role message:",
        error,
      );
      res.status(500).json({ error: "Server error" });
    }
  },
);

configRouter.delete(
  "/reaction-roles/:id",
  async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    const { magicLinkService, discordClient } = getServerContext(req);

    try {
      const session = await magicLinkService.validateSession(token, "config");
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const msgId = Number.parseInt(req.params.id as string);

      const messageRecord = await db
        .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
        .selectAll()
        .where("id", "=", msgId)
        .where("guild_id", "=", session.guild_id)
        .executeTakeFirst();

      if (!messageRecord) {
        return res.status(404).json({ error: "Message not found" });
      }

      // Attempt to delete Discord message
      try {
        const channel = await discordClient.channels.fetch(
          messageRecord.channel_id,
        );
        if (channel && channel.isTextBased()) {
          const discordMsg = await channel.messages.fetch(
            messageRecord.message_id,
          );
          if (discordMsg) await discordMsg.delete();
        }
      } catch (e) {
        console.warn("Failed to delete reaction role discord message:", e);
      }

      await db
        .deleteFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
        .where("id", "=", msgId)
        .execute();

      // mappings will cascaded or cleaned up, but explicitly deleting them is safer
      await db
        .deleteFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
        .where("message_id", "=", messageRecord.message_id)
        .execute();

      await logGuildAction(session.guild_id, discordClient, {
        title: "Reaction Role Message Deleted",
        description: `<@${session.discord_id}> deleted a reaction role message via Web Dashboard.`,
        color: 0xef4444,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error("[HTTP] Error deleting reaction role message:", error);
      res.status(500).json({ error: "Server error" });
    }
  },
);

configRouter.get(
  "/faction-lookup/:factionId",
  async (req: Request, res: Response) => {
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
  },
);

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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({
        error: `API Key Validation Failed: ${message}`,
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
