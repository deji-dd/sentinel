import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { EmbedBuilder } from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../lib/db-client.js";
import { sql } from "kysely";
import { ensureMercRegistrationPanel } from "../../lib/mercenary-interactions.js";
import {
  getGuildApiKeys,
  storeGuildApiKey,
  getPrimaryGuildApiKey,
} from "../../lib/guild-api-keys.js";
import { validateAndFetchFactionDetails } from "../../lib/faction-utils.js";
import { tornApi } from "../../services/torn-client.js";
import { validateTornApiKey } from "../../services/torn-client.js";
import { logGuildSuccess, logGuildAction } from "../../lib/guild-logger.js";
import {
  syncAutoVerifyCronSchedule,
  syncWarTrackerCronSchedules,
  syncMercenaryTrackerCronSchedules,
  syncBazaarMugCronSchedule,
  syncAllGuildCronSchedules,
} from "../../lib/cron-schedule-registry.js";
import { getServerContext } from "../context.js";
import { runMercenaryTrackerGuildSync } from "../../lib/mercenary-tracker.js";
import { postContractReport } from "../../lib/mercenary-reporter.js";

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
  upcomingWarStartTime: string | null;
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
  let upcomingWarStartTime: string | null = null;

  for (const war of wars) {
    const start = war.start_time;
    const end = war.end_time;

    if (start > nowIso) {
      hasUpcomingWar = true;
      if (!upcomingWarStartTime || start < upcomingWarStartTime) {
        upcomingWarStartTime = start;
      }
      continue;
    }

    if (!end || end > nowIso) {
      hasActiveWar = true;
    }
  }

  return { hasActiveWar, hasUpcomingWar, upcomingWarStartTime };
}

function normalizeMercenaryContractRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
) {
  return {
    ...row,
    target_roles: parseJsonArray(row.target_roles_json),
    hit_count: 0,
    total_payout: 0,
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

    // Query hits counts and totals grouped by contract_id
    const hitsSummary = await db
      .selectFrom(TABLE_NAMES.MERCENARY_VERIFICATION_VAULT)
      .select([
        "contract_id",
        db.fn.count("id").as("hit_count"),
        db.fn.sum("payout_amount").as("total_payout"),
      ])
      .where("result", "=", "verified")
      .groupBy("contract_id")
      .execute();

    const summaryMap = new Map(
      hitsSummary.map((s) => [
        s.contract_id,
        {
          hit_count: Number(s.hit_count) || 0,
          total_payout: Number(s.total_payout) || 0,
        },
      ]),
    );

    const contracts = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
      .selectAll()
      .where("guild_id", "=", guildId)
      .orderBy("created_at", "desc")
      .execute();

    const normalizedContracts = contracts.map((c) => {
      const norm = normalizeMercenaryContractRow(c);
      const summary = summaryMap.get(norm.id) || { hit_count: 0, total_payout: 0 };
      return {
        ...norm,
        hit_count: summary.hit_count,
        total_payout: summary.total_payout,
      };
    });

    const activeContracts = normalizedContracts.filter((contract) =>
      ["active", "paused"].includes(contract.status),
    );

    const pastContracts = normalizedContracts.filter(
      (contract) => !["active", "paused"].includes(contract.status),
    );

    const dibsConfig = await db
      .selectFrom(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    res.json({
      settings: {
        guild_id: guildId,
        contract_announcement_channel_id:
          settings?.contract_announcement_channel_id ?? null,
        hit_post_channel_id: settings?.hit_post_channel_id ?? null,
        payout_channel_id: settings?.payout_channel_id ?? null,
        audit_channel_id: settings?.audit_channel_id ?? null,
        merc_registration_channel_id:
          dibsConfig?.merc_registration_channel_id ?? null,
        max_active_dibs_per_person: dibsConfig?.max_active_dibs_per_person ?? 5,
        dibs_remaining_minutes: dibsConfig?.dibs_remaining_minutes ?? 15,
        dibs_enabled: dibsConfig?.is_enabled ?? 1,
        merc_role_ids: parseJsonArray(settings?.merc_role_ids_json),
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
        contract_announcement_channel_id,
        hit_post_channel_id,
        payout_channel_id,
        audit_channel_id,
        merc_registration_channel_id,
        max_active_dibs_per_person,
        dibs_remaining_minutes,
        dibs_enabled,
        merc_role_ids,
      } = req.body;

      // Get current config to check if registration channel changed and track changes
      const currentConfig = await db
        .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
        .selectAll()
        .where("guild_id", "=", guildId)
        .executeTakeFirst();

      const currentDibs = await db
        .selectFrom(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
        .selectAll()
        .where("guild_id", "=", guildId)
        .executeTakeFirst();

      const changes: string[] = [];

      if (
        contract_announcement_channel_id !== undefined &&
        contract_announcement_channel_id !==
          (currentConfig?.contract_announcement_channel_id ?? null)
      ) {
        changes.push("Contract Announcement Channel");
      }
      if (
        hit_post_channel_id !== undefined &&
        hit_post_channel_id !== (currentConfig?.hit_post_channel_id ?? null)
      ) {
        changes.push("Hit Post Channel");
      }
      if (
        payout_channel_id !== undefined &&
        payout_channel_id !== (currentConfig?.payout_channel_id ?? null)
      ) {
        changes.push("Payout Channel");
      }
      if (
        audit_channel_id !== undefined &&
        audit_channel_id !== (currentConfig?.audit_channel_id ?? null)
      ) {
        changes.push("Audit Channel");
      }
      if (
        merc_registration_channel_id !== undefined &&
        merc_registration_channel_id !==
          (currentConfig?.merc_registration_channel_id ?? null)
      ) {
        changes.push("Mercenary Registration Channel");
      }
      if (merc_role_ids !== undefined) {
        const oldRoles = currentConfig?.merc_role_ids_json
          ? parseJsonArray(currentConfig.merc_role_ids_json)
          : [];
        const newRoles = merc_role_ids || [];
        if (
          JSON.stringify([...oldRoles].sort()) !==
          JSON.stringify([...newRoles].sort())
        ) {
          changes.push("Mercenary Role(s)");
        }
      }
      if (
        max_active_dibs_per_person !== undefined &&
        max_active_dibs_per_person !==
          (currentDibs?.max_active_dibs_per_person ?? 5)
      ) {
        changes.push("Max Active Dibs Per Person");
      }
      if (
        dibs_remaining_minutes !== undefined &&
        dibs_remaining_minutes !== (currentDibs?.dibs_remaining_minutes ?? 15)
      ) {
        changes.push("Dibs Remaining Minutes");
      }
      if (dibs_enabled !== undefined) {
        const newVal = dibs_enabled ? 1 : 0;
        if (newVal !== (currentDibs?.is_enabled ?? 1)) {
          changes.push("Mercenary Dibs Module");
        }
      }

      // Update main mercenary config
      await db
        .insertInto(TABLE_NAMES.MERCENARY_CONFIG)
        .values({
          guild_id: guildId,
          contract_announcement_channel_id:
            contract_announcement_channel_id || null,
          hit_post_channel_id: hit_post_channel_id || null,
          payout_channel_id: payout_channel_id || null,
          audit_channel_id: audit_channel_id || null,
          merc_registration_channel_id: merc_registration_channel_id || null,
          merc_role_ids_json: JSON.stringify(merc_role_ids || []),
          updated_by: session.discord_id,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.column("guild_id").doUpdateSet({
            contract_announcement_channel_id:
              contract_announcement_channel_id || null,
            hit_post_channel_id: hit_post_channel_id || null,
            payout_channel_id: payout_channel_id || null,
            audit_channel_id: audit_channel_id || null,
            merc_registration_channel_id: merc_registration_channel_id || null,
            merc_role_ids_json: JSON.stringify(merc_role_ids || []),
            updated_by: session.discord_id,
            updated_at: now,
          }),
        )
        .execute();

      // Update dibs config
      await db
        .insertInto(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
        .values({
          guild_id: guildId,
          merc_registration_channel_id: merc_registration_channel_id || null,
          max_active_dibs_per_person: max_active_dibs_per_person ?? 5,
          dibs_remaining_minutes: dibs_remaining_minutes ?? 15,
          is_enabled: dibs_enabled ?? 1,
          updated_by: session.discord_id,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.column("guild_id").doUpdateSet({
            merc_registration_channel_id: merc_registration_channel_id || null,
            max_active_dibs_per_person: max_active_dibs_per_person ?? 5,
            dibs_remaining_minutes: dibs_remaining_minutes ?? 15,
            is_enabled: dibs_enabled ?? 1,
            updated_by: session.discord_id,
            updated_at: now,
          }),
        )
        .execute();

      // Handle old registration message cleanup if channel changed or was cleared
      if (
        currentConfig &&
        currentConfig.merc_registration_channel_id &&
        currentConfig.merc_registration_message_id
      ) {
        if (
          currentConfig.merc_registration_channel_id !==
          merc_registration_channel_id
        ) {
          try {
            const oldChannel = await discordClient.channels.fetch(
              currentConfig.merc_registration_channel_id,
            );
            if (oldChannel && oldChannel.isTextBased()) {
              const oldMsg = await oldChannel.messages.fetch(
                currentConfig.merc_registration_message_id,
              );
              if (oldMsg) await oldMsg.delete();
            }
          } catch (e) {
            console.error("Failed to delete old registration message:", e);
          }
        }
      }

      // Ensure/post the registration panel in the configured channel
      if (merc_registration_channel_id) {
        await ensureMercRegistrationPanel(discordClient, guildId);
      } else {
        await db
          .updateTable(TABLE_NAMES.MERCENARY_CONFIG)
          .set({ merc_registration_message_id: null })
          .where("guild_id", "=", guildId)
          .execute();
      }

      await logGuildAction(guildId, discordClient, {
        title: "Mercenary Module Settings Updated",
        description: `<@${session.discord_id}> updated mercenary module settings.`,
        fields:
          changes.length > 0
            ? [
                {
                  name: "Settings Updated",
                  value: changes.join(", "),
                  inline: false,
                },
              ]
            : undefined,
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
        status,
        start_at,
        ends_at,
        faction_id,
        target_scope,
        idle_minutes,
        min_level,
        max_level,
        target_roles,
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

      const now = new Date().toISOString();
      const contractId = randomUUID();

      await db
        .insertInto(TABLE_NAMES.MERCENARY_CONTRACTS)
        .values({
          id: contractId,
          guild_id: guildId,
          title: String(title).trim(),
          description: description || null,
          contract_type: contract_type || "hosp",
          status: status || "active",
          pay_amount: Number(pay_amount) || 0,
          pay_currency: "cash",
          pay_terms: null,
          start_at: start_at || null,
          ends_at: ends_at || null,
          created_by: session.discord_id,
          updated_at: now,
          faction_id: factionIdNumber,
          faction_name: faction.name,
          target_scope: target_scope || "offline_and_idle",
          idle_minutes: idle_minutes ? Number(idle_minutes) : null,
          auto_finish_on_war_end: 0,
          min_level: min_level ? Number(min_level) : null,
          max_level: max_level ? Number(max_level) : null,
          target_roles_json: JSON.stringify(
            Array.isArray(target_roles) ? target_roles : [],
          ),
          require_faction_no_active_war: 0,
          require_faction_no_upcoming_war: 0,
        })
        .execute();

      await logGuildAction(guildId, discordClient, {
        title: "Mercenary Contract Created",
        description: `<@${session.discord_id}> created **${String(title).trim()}** contract for faction ${faction.name}.`,
      });

      // Fetch mercenary config for announcements
      const config = await db
        .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
        .selectAll()
        .where("guild_id", "=", guildId)
        .executeTakeFirst();

      if (config?.contract_announcement_channel_id) {
        try {
          const annChannel = await discordClient.channels
            .fetch(config.contract_announcement_channel_id)
            .catch(() => null);
          if (annChannel && annChannel.isTextBased()) {
            let rolePings = "";
            if (config.merc_role_ids_json) {
              try {
                const roleIds = JSON.parse(config.merc_role_ids_json);
                if (Array.isArray(roleIds)) {
                  rolePings = roleIds.map((id) => `<@&${id}>`).join(" ");
                }
              } catch {
                // Invalid JSON in merc_role_ids_json, skip role pings
              }
            }

            let startText = "**Starting Now**";
            if (start_at) {
              const startTimestamp = Math.floor(
                new Date(start_at).getTime() / 1000,
              );
              if (new Date(start_at) > new Date()) {
                startText = `**Starting <t:${startTimestamp}:R>**`;
              } else {
                startText = `**Started <t:${startTimestamp}:R>**`;
              }
            }

            let contractTypeText = "Mixed / Any";
            if (contract_type === "hosp") {
              contractTypeText = "Hospitalize";
            } else if (contract_type === "leave") {
              contractTypeText = "Leave on Street";
            } else if (contract_type === "mug") {
              contractTypeText = "Mug";
            } else if (contract_type === "mixed") {
              contractTypeText = "Mixed";
            }

            let targetScopeText = "All Members";
            if (target_scope === "offline_only") {
              targetScopeText = "Offline Only";
            } else if (target_scope === "offline_and_idle") {
              targetScopeText = `Offline & Idle (${idle_minutes || 0}m+)`;
            }

            let levelText = "Any Level";
            if (min_level && max_level) {
              levelText = `${min_level} - ${max_level}`;
            } else if (min_level) {
              levelText = `${min_level}+`;
            } else if (max_level) {
              levelText = `≤${max_level}`;
            }

            const embed = new EmbedBuilder()
              .setColor(0x10b981)
              .setTitle(`New Mercenary Contract: ${String(title).trim()}`)
              .setDescription(description || "No description provided.")
              .addFields(
                {
                  name: "Target Faction",
                  value: `${faction.name} [${factionIdNumber}]`,
                  inline: true,
                },
                {
                  name: "Payout",
                  value:
                    pay_amount > 0
                      ? `$${Number(pay_amount).toLocaleString()} per hit`
                      : "No payment",
                  inline: true,
                },
                { name: "Start Status", value: startText, inline: true },
                {
                  name: "Contract Type",
                  value: contractTypeText,
                  inline: true,
                },
                {
                  name: "Target Scope",
                  value: targetScopeText,
                  inline: true,
                },
                {
                  name: "Target Levels",
                  value: levelText,
                  inline: true,
                },
              );

            const rolesList = Array.isArray(target_roles) ? target_roles : [];
            if (rolesList.length > 0) {
              let isAllSelected = false;
              try {
                const membersResponse = await tornApi.get("/faction/{id}/members", {
                  apiKey,
                  pathParams: { id: String(factionIdNumber) },
                });
                const availableRoles = new Set<string>();
                const members = membersResponse.members;
                if (members && typeof members === "object") {
                  const memberList = Array.isArray(members) ? members : Object.values(members);
                  for (const member of memberList) {
                    if (member && typeof member === "object" && "position" in member && typeof member.position === "string") {
                      availableRoles.add(member.position);
                    }
                  }
                }
                if (availableRoles.size > 0 && rolesList.length >= availableRoles.size && rolesList.every((r: string) => availableRoles.has(r))) {
                  isAllSelected = true;
                }
              } catch (err) {
                console.error("Failed to fetch faction members for roles check:", err);
              }

              embed.addFields({
                name: "Target Roles",
                value: isAllSelected ? "All Roles" : rolesList.join(", "),
                inline: false,
              });
            }

            embed.setFooter({ text: "Sentinel" }).setTimestamp();

            await annChannel.send({
              content: rolePings ? `${rolePings}!` : undefined,
              embeds: [embed],
            });
          }
        } catch (err) {
          console.error("Failed to post mercenary contract announcement:", err);
        }
      }

      // Sync cron schedules immediately to trigger target tracking
      await syncMercenaryTrackerCronSchedules().catch((err) => {
        console.error("Failed to sync mercenary tracker cron schedules:", err);
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

      const guildId = session.guild_id as string;
      const contractId = req.params.id as string;
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

      if (req.body.status !== undefined) {
        updateData.status = req.body.status;
        if (["completed", "cancelled", "closed"].includes(req.body.status)) {
          updateData.closed_at = new Date().toISOString();
        }
      }

      const oldStatus = existing.status;
      const newStatus = req.body.status !== undefined ? req.body.status : oldStatus;

      await db
        .updateTable(TABLE_NAMES.MERCENARY_CONTRACTS)
        .set(updateData)
        .where("id", "=", contractId)
        .where("guild_id", "=", guildId)
        .execute();

      const updatedContract = await db
        .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
        .selectAll()
        .where("id", "=", contractId)
        .where("guild_id", "=", guildId)
        .executeTakeFirst();

      // Trigger completion report if newly completed/closed/cancelled
      if (
        ["completed", "cancelled", "closed"].includes(newStatus) &&
        !["completed", "cancelled", "closed"].includes(oldStatus)
      ) {
        void postContractReport(discordClient, contractId, guildId as string).catch((err) => {
          console.error("Failed to post contract completion report:", err);
        });
      } else {
        // Otherwise, send change notification to mercenary announcement channel
        const settings = await db
          .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
          .selectAll()
          .where("guild_id", "=", guildId)
          .executeTakeFirst();

        if (settings?.contract_announcement_channel_id && updatedContract) {
          const annChannel = await discordClient.channels
            .fetch(settings.contract_announcement_channel_id)
            .catch(() => null);
          if (annChannel && annChannel.isTextBased()) {
            let targetScopeText = "All Members";
            if (updatedContract.target_scope === "offline_only") {
              targetScopeText = "Offline Only";
            } else if (updatedContract.target_scope === "offline_and_idle") {
              targetScopeText = `Offline & Idle (${updatedContract.idle_minutes || 0}m+)`;
            }

            const changeEmbed = new EmbedBuilder()
              .setColor(0xf59e0b) // Amber color for update
              .setTitle(`Mercenary Contract Updated: ${updatedContract.title}`)
              .setDescription(`The contract details have been updated by an administrator.`)
              .addFields(
                {
                  name: "Target Faction",
                  value: `${updatedContract.faction_name || "Unknown"} [${updatedContract.faction_id || "N/A"}]`,
                  inline: true,
                },
                {
                  name: "Payout",
                  value:
                    updatedContract.pay_amount > 0
                      ? `$${Number(updatedContract.pay_amount).toLocaleString()} per hit`
                      : "No payment",
                  inline: true,
                },
                {
                  name: "Target Scope",
                  value: targetScopeText,
                  inline: true,
                },
                {
                  name: "Contract Type",
                  value: updatedContract.contract_type === "hosp" ? "Hospitalize" : updatedContract.contract_type === "mug" ? "Mug" : updatedContract.contract_type === "leave" ? "Leave on Street" : "Mixed",
                  inline: true,
                },
              );

            if (updatedContract.description) {
              changeEmbed.addFields({ name: "Notes", value: updatedContract.description, inline: false });
            }

            await annChannel.send({ embeds: [changeEmbed] }).catch(() => {});
          }
        }
      }

      await logGuildAction(guildId, discordClient, {
        title: "Mercenary Contract Updated",
        description: `<@${session.discord_id}> updated contract **${existing.title}**.`,
      });

      // Sync tracking and schedules immediately on update
      void syncMercenaryTrackerCronSchedules().catch(console.error);
      void runMercenaryTrackerGuildSync(discordClient, guildId).catch(
        console.error,
      );

      const hitSummary = await db
        .selectFrom(TABLE_NAMES.MERCENARY_VERIFICATION_VAULT)
        .select([
          db.fn.count("id").as("hit_count"),
          db.fn.sum("payout_amount").as("total_payout"),
        ])
        .where("contract_id", "=", contractId)
        .where("result", "=", "verified")
        .executeTakeFirst();

      res.json({
        ok: true,
        contract: updatedContract
          ? {
              ...normalizeMercenaryContractRow(updatedContract),
              hit_count: Number(hitSummary?.hit_count) || 0,
              total_payout: Number(hitSummary?.total_payout) || 0,
            }
          : null,
      });
    } catch (error) {
      console.error("[HTTP] Error updating mercenary contract:", error);
      res.status(500).json({ error: "Server error" });
    }
  },
);

configRouter.get(
  "/mercenary/contracts/:id/hits",
  async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    const { magicLinkService } = getServerContext(req);

    try {
      const session = await magicLinkService.validateSession(token, "config");
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const guildId = session.guild_id;
      const contractId = req.params.id;

      // 1. Verify contract belongs to guild
      const contract = await db
        .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
        .select("id")
        .where("id", "=", contractId)
        .where("guild_id", "=", guildId)
        .executeTakeFirst();

      if (!contract) {
        return res.status(404).json({ error: "Contract not found" });
      }

      // 2. Fetch all verified and invalid hits from vault
      const hits = await db
        .selectFrom(TABLE_NAMES.MERCENARY_VERIFICATION_VAULT)
        .selectAll()
        .where("contract_id", "=", contractId)
        .where("result", "in", ["verified", "invalid_type"])
        .orderBy("occurred_at", "desc")
        .execute();

      res.json({ hits });
    } catch (error) {
      console.error("[HTTP] Error fetching contract hits:", error);
      res.status(500).json({ error: "Server error" });
    }
  },
);

configRouter.get(
  "/mercenary/faction/:id",
  async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    const { magicLinkService } = getServerContext(req);

    try {
      const session = await magicLinkService.validateSession(token, "config");
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const guildId = session.guild_id;
      const factionId = Number(req.params.id);

      if (!factionId || !Number.isInteger(factionId) || factionId <= 0) {
        return res.status(400).json({ error: "Valid faction_id is required" });
      }

      const apiKey = await getPrimaryGuildApiKey(guildId);
      if (!apiKey) {
        return res.status(400).json({
          error:
            "No primary API key configured. Add one in Admin Config before verifying factions.",
        });
      }

      const faction = await validateAndFetchFactionDetails(factionId, apiKey);
      if (!faction) {
        return res.status(400).json({
          error:
            "Faction verification failed. Check faction_id and API key scope.",
        });
      }

      const membersResponse = await tornApi.get("/faction/{id}/members", {
        apiKey,
        pathParams: { id: String(factionId) },
      });

      // Extract available roles from faction members
      const availableRoles = new Set<string>();
      const members = membersResponse.members;
      if (Array.isArray(members)) {
        for (const member of members) {
          if (member?.position && typeof member.position === "string") {
            availableRoles.add(member.position);
          }
        }
      }

      const warState = await getFactionWarState(factionId);

      res.json({
        faction_name: faction.name,
        available_roles: Array.from(availableRoles).sort(),
        target_roles: Array.from(availableRoles).sort(),
        has_active_war: warState.hasActiveWar,
        has_upcoming_war: warState.hasUpcomingWar,
      });
    } catch (error) {
      console.error("[HTTP] Error verifying faction:", error);
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

      // Trigger scheduler update for auto-verify if it changed
      if (changes.includes("Auto-Verify")) {
        await syncAutoVerifyCronSchedule(guildId, discordClient);
      }

      if (changes.includes("Modules")) {
        await syncAllGuildCronSchedules(guildId, discordClient);
      }

      // Log the change
      await logGuildSuccess(
        guildId,
        discordClient,
        "System Configuration Updated",
        `<@${session.discord_id}> updated the guild configuration.`,
        [
          {
            name: "Settings Updated",
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
      description: `<@${session.discord_id}> created a new reaction role message in <#${channel_id}>.`,
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
        description: `<@${session.discord_id}> updated a reaction role message in <#${existing.channel_id}>.`,
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
        description: `<@${session.discord_id}> deleted a reaction role message.`,
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

    // Refresh the auto-verify schedule
    await syncAutoVerifyCronSchedule(session.guild_id, discordClient);

    const isNew = !id;
    const targetFaction = faction_name || faction_id;
    await logGuildAction(session.guild_id, discordClient, {
      title: isNew
        ? `Faction Mapping Added: ${targetFaction}`
        : `Faction Mapping Updated: ${targetFaction}`,
      description: isNew
        ? `Added by <@${session.discord_id}>`
        : `Updated by <@${session.discord_id}>`,
      color: 0x22c55e, // Success (green)
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

      const mapping = await db
        .selectFrom(TABLE_NAMES.FACTION_ROLES)
        .select(["faction_id", "faction_name"])
        .where("id", "=", id)
        .where("guild_id", "=", session.guild_id)
        .executeTakeFirst();

      await db
        .deleteFrom(TABLE_NAMES.FACTION_ROLES)
        .where("id", "=", id)
        .where("guild_id", "=", session.guild_id)
        .execute();

      // Refresh the auto-verify schedule
      await syncAutoVerifyCronSchedule(session.guild_id, discordClient);

      const targetFaction = mapping
        ? mapping.faction_name || mapping.faction_id
        : "Unknown Faction";

      await logGuildAction(session.guild_id, discordClient, {
        title: `Faction Mapping Deleted: ${targetFaction}`,
        description: `Deleted by <@${session.discord_id}>`,
        color: 0xef4444, // Alert (red)
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

    await syncAutoVerifyCronSchedule(session.guild_id, discordClient);
    await syncWarTrackerCronSchedules();

    // Log the addition (mask the key)
    const maskedKey = `...${api_key.slice(-4)}`;
    await logGuildSuccess(
      session.guild_id,
      discordClient,
      "API Key Added",
      `<@${session.discord_id}> added a new Torn API key (${maskedKey}).`,
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
        description: `<@${session.discord_id}> removed a Torn API key.`,
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

    await syncAutoVerifyCronSchedule(session.guild_id, discordClient);
    await syncWarTrackerCronSchedules();

    res.json({ ok: true });
  } catch (error) {
    console.error("[HTTP] Error deleting API key:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.get("/bazaar-mug", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session || !session.guild_id)
      return res.status(401).json({ error: "Invalid or expired session" });

    const guildId = session.guild_id;

    const settings = await db
      .selectFrom(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    res.json({
      settings: {
        guild_id: guildId,
        is_enabled: settings?.is_enabled ?? 0,
        min_bazaar_drop_threshold: settings?.min_bazaar_drop_threshold ?? 10000000,
        ping_role_id: settings?.ping_role_id ?? null,
        notification_channel_id: settings?.notification_channel_id ?? null,
        target_player_ids: parseJsonArray(settings?.target_player_ids_json),
      },
    });
  } catch (error) {
    console.error("[HTTP] Error fetching bazaar-mug config:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.post("/bazaar-mug", async (req: Request, res: Response) => {
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
      min_bazaar_drop_threshold,
      ping_role_id,
      notification_channel_id,
      target_player_ids,
    } = req.body;

    const currentConfig = await db
      .selectFrom(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    const changes: string[] = [];

    if (is_enabled !== undefined) {
      const newVal = is_enabled ? 1 : 0;
      if (newVal !== (currentConfig?.is_enabled ?? 0)) {
        changes.push(is_enabled ? "Enabled module" : "Disabled module");
      }
    }
    if (min_bazaar_drop_threshold !== undefined && min_bazaar_drop_threshold !== (currentConfig?.min_bazaar_drop_threshold ?? 10000000)) {
      changes.push(`Minimum Bazaar Drop Threshold to $${Number(min_bazaar_drop_threshold).toLocaleString()}`);
    }
    if (ping_role_id !== undefined && ping_role_id !== (currentConfig?.ping_role_id ?? null)) {
      changes.push("Mention Role");
    }
    if (notification_channel_id !== undefined && notification_channel_id !== (currentConfig?.notification_channel_id ?? null)) {
      changes.push("Notification Channel");
    }
    if (target_player_ids !== undefined) {
      const oldPlayers = currentConfig?.target_player_ids_json
        ? parseJsonArray(currentConfig.target_player_ids_json)
        : [];
      const newPlayers = target_player_ids || [];
      if (
        JSON.stringify([...oldPlayers].sort()) !==
        JSON.stringify([...newPlayers].sort())
      ) {
        changes.push("Target Player Watchlist");
      }
    }

    if (changes.length > 0) {
      await db
        .insertInto(TABLE_NAMES.BAZAAR_MUG_CONFIG)
        .values({
          guild_id: guildId,
          is_enabled: is_enabled ? 1 : 0,
          min_bazaar_drop_threshold: Number(min_bazaar_drop_threshold) || 10000000,
          ping_role_id: ping_role_id || null,
          notification_channel_id: notification_channel_id || null,
          target_player_ids_json: JSON.stringify(target_player_ids || []),
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.column("guild_id").doUpdateSet({
            is_enabled: is_enabled ? 1 : 0,
            min_bazaar_drop_threshold: Number(min_bazaar_drop_threshold) || 10000000,
            ping_role_id: ping_role_id || null,
            notification_channel_id: notification_channel_id || null,
            target_player_ids_json: JSON.stringify(target_player_ids || []),
            updated_at: now,
          }),
        )
        .execute();

      await logGuildSuccess(
        guildId,
        discordClient,
        "Bazaar Mug Configuration Updated",
        `<@${session.discord_id}> updated the Bazaar Mug configuration.`,
        [
          {
            name: "Settings Updated",
            value: changes.join(", "),
            inline: false,
          },
        ],
      );
    }
    await syncBazaarMugCronSchedule(guildId, discordClient);

    res.json({ ok: true });
  } catch (error) {
    console.error("[HTTP] Error updating bazaar-mug config:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.get("/personal", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session) return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    const userId = process.env.SENTINEL_USER_ID;
    if (!userId) {
      return res.status(500).json({ error: "SENTINEL_USER_ID is not configured on server" });
    }

    let settings = await db
      .selectFrom(TABLE_NAMES.PERSONAL_SETTINGS)
      .selectAll()
      .where("user_id", "=", String(userId))
      .executeTakeFirst();

    if (!settings) {
      const now = new Date().toISOString();
      const defaultSettings = {
        user_id: String(userId),
        discord_id: String(botOwnerId),
        energy_alerts_enabled: 0,
        energy_soft_threshold: 130,
        energy_aggressive_interval_mins: 5,
        last_energy_alert_sent_at: null,
        last_energy_alert_type: null,
        admin_log_channel_id: null,
        error_pings_enabled: 1,
        selected_build: "balanced",
        target_strength_ratio: 25.0,
        target_defense_ratio: 25.0,
        target_speed_ratio: 25.0,
        target_dexterity_ratio: 25.0,
        updated_at: now,
      };

      await db
        .insertInto(TABLE_NAMES.PERSONAL_SETTINGS)
        .values(defaultSettings as any)
        .execute();

      settings = await db
        .selectFrom(TABLE_NAMES.PERSONAL_SETTINGS)
        .selectAll()
        .where("user_id", "=", String(userId))
        .executeTakeFirst();
    }

    res.json(settings);
  } catch (error) {
    console.error("[HTTP] Error fetching personal config:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.post("/personal", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session) return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    const userId = process.env.SENTINEL_USER_ID;
    if (!userId) {
      return res.status(500).json({ error: "SENTINEL_USER_ID is not configured on server" });
    }

    const {
      energy_alerts_enabled,
      energy_soft_threshold,
      energy_aggressive_interval_mins,
      admin_log_channel_id,
      error_pings_enabled,
      selected_build,
      target_strength_ratio,
      target_defense_ratio,
      target_speed_ratio,
      target_dexterity_ratio,
    } = req.body;

    const softThreshold = Number(energy_soft_threshold);
    if (isNaN(softThreshold) || softThreshold < 0 || softThreshold > 150) {
      return res
        .status(400)
        .json({ error: "Energy soft threshold must be a number between 0 and 150" });
    }

    const aggressiveInterval = Number(energy_aggressive_interval_mins);
    if (
      isNaN(aggressiveInterval) ||
      aggressiveInterval < 1 ||
      aggressiveInterval > 1440
    ) {
      return res
        .status(400)
        .json({ error: "Energy aggressive interval must be a number between 1 and 1440 minutes" });
    }

    const build = typeof selected_build === "string" ? selected_build.toLowerCase() : "balanced";
    const strengthRatio = Number(target_strength_ratio) || 0;
    const defenseRatio = Number(target_defense_ratio) || 0;
    const speedRatio = Number(target_speed_ratio) || 0;
    const dexterityRatio = Number(target_dexterity_ratio) || 0;

    const totalRatio = strengthRatio + defenseRatio + speedRatio + dexterityRatio;
    if (Math.abs(totalRatio - 100) > 0.5) {
      return res
        .status(400)
        .json({ error: `Target stat build ratios must add up to exactly 100% (currently ${totalRatio}%)` });
    }

    const now = new Date().toISOString();

    await db
      .insertInto(TABLE_NAMES.PERSONAL_SETTINGS)
      .values({
        user_id: String(userId),
        discord_id: String(botOwnerId),
        energy_alerts_enabled: energy_alerts_enabled ? 1 : 0,
        energy_soft_threshold: softThreshold,
        energy_aggressive_interval_mins: aggressiveInterval,
        admin_log_channel_id: admin_log_channel_id || null,
        error_pings_enabled: error_pings_enabled ? 1 : 0,
        selected_build: build,
        target_strength_ratio: strengthRatio,
        target_defense_ratio: defenseRatio,
        target_speed_ratio: speedRatio,
        target_dexterity_ratio: dexterityRatio,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet({
          energy_alerts_enabled: energy_alerts_enabled ? 1 : 0,
          energy_soft_threshold: softThreshold,
          energy_aggressive_interval_mins: aggressiveInterval,
          admin_log_channel_id: admin_log_channel_id || null,
          error_pings_enabled: error_pings_enabled ? 1 : 0,
          selected_build: build,
          target_strength_ratio: strengthRatio,
          target_defense_ratio: defenseRatio,
          target_speed_ratio: speedRatio,
          target_dexterity_ratio: dexterityRatio,
          updated_at: now,
        }),
      )
      .execute();

    // Log update to admin logging channel
    const { sendAdminSystemLog } = await import("../../lib/admin-logger.js");
    await sendAdminSystemLog(
      getServerContext(req).discordClient,
      "info",
      `Owner <@${session.discord_id}> updated Personal Settings (alerts_enabled: ${energy_alerts_enabled ? "yes" : "no"}, soft_threshold: ${softThreshold}, logging_channel: ${admin_log_channel_id || "none"})`
    ).catch(() => {});

    res.json({ ok: true });
  } catch (error) {
    console.error("[HTTP] Error updating personal config:", error);
    res.status(500).json({ error: "Server error" });
  }
});

configRouter.get("/personal/milestones", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session) return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    const userId = process.env.SENTINEL_USER_ID;
    if (!userId) {
      return res.status(500).json({ error: "SENTINEL_USER_ID is not configured on server" });
    }

    // 1. Fetch current battle stats from snapshots
    const stats = await db
      .selectFrom(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();

    const statsData = stats
      ? {
          strength: stats.strength,
          speed: stats.speed,
          defense: stats.defense,
          dexterity: stats.dexterity,
          total_stats: stats.total_stats,
        }
      : {
          strength: 50000,
          speed: 50000,
          defense: 50000,
          dexterity: 50000,
          total_stats: 200000,
        };

    // 2. Fetch latest user snapshot (active gym, current/max happy, current/max energy)
    const userSnapshot = await db
      .selectFrom(TABLE_NAMES.USER_SNAPSHOTS)
      .select(["active_gym", "happy_current", "happy_maximum", "energy_current", "energy_maximum"])
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
    
    let activeGym = {
      name: "Premier Fitness",
      strength: 20,
      speed: 20,
      defense: 20,
      dexterity: 20,
    };

    if (userSnapshot?.active_gym) {
      const gym = await db
        .selectFrom(TABLE_NAMES.TORN_GYMS)
        .selectAll()
        .where("id", "=", userSnapshot.active_gym)
        .executeTakeFirst();
      if (gym) {
        activeGym = {
          name: gym.name,
          strength: gym.strength,
          speed: gym.speed,
          defense: gym.defense,
          dexterity: gym.dexterity,
        };
      }
    }

    // 3. Compute happiness and energy stats from the latest snapshot
    const maxHappy = userSnapshot?.happy_maximum ? Number(userSnapshot.happy_maximum) : 5000;
    const currentHappy = userSnapshot?.happy_current ? Number(userSnapshot.happy_current) : 5000;
    const currentEnergy = userSnapshot?.energy_current ? Number(userSnapshot.energy_current) : 0;
    const maxEnergy = userSnapshot?.energy_maximum ? Number(userSnapshot.energy_maximum) : 150;
    const avgHappy = maxHappy; // Use player maximum happy as training baseline

    // Average daily energy
    const fourteenDaysAgo = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60;
    const recentEnergy = await db
      .selectFrom("sentinel_gym_train_logs" as any)
      .select(db.fn.sum("energy").as("total_energy"))
      .where("timestamp", ">=", fourteenDaysAgo)
      .executeTakeFirst();
    
    const totalEnergy = parseFloat(recentEnergy?.total_energy as string) || 0;
    let avgDailyEnergy = totalEnergy / 14;
    
    if (avgDailyEnergy < 50) {
      // Calculate avg over actual log range if data spans less than 14 days
      const firstLog = await db
        .selectFrom("sentinel_gym_train_logs" as any)
        .select("timestamp")
        .orderBy("timestamp", "asc")
        .limit(1)
        .executeTakeFirst();
      
      if (firstLog) {
        const daysSpan = Math.max(1, Math.ceil((Date.now() / 1000 - Number(firstLog.timestamp)) / (24 * 60 * 60)));
        const allTimeEnergy = await db
          .selectFrom("sentinel_gym_train_logs" as any)
          .select(db.fn.sum("energy").as("total_energy"))
          .executeTakeFirst();
        const totalAllTimeEnergy = parseFloat(allTimeEnergy?.total_energy as string) || 0;
        avgDailyEnergy = totalAllTimeEnergy / daysSpan;
      }
    }
    
    if (avgDailyEnergy < 50) {
      avgDailyEnergy = 250; // default to standard active player training
    }

    // Stat distribution
    const distributionLogs = await db
      .selectFrom("sentinel_gym_train_logs" as any)
      .select(["stat", db.fn.count("log_id").as("count")])
      .groupBy("stat")
      .execute();
    
    const distCounts: Record<string, number> = {
      strength: 0,
      speed: 0,
      defense: 0,
      dexterity: 0,
    };
    let totalCount = 0;
    for (const item of distributionLogs) {
      const s = String(item.stat).toLowerCase();
      const count = Number(item.count);
      if (s in distCounts) {
        distCounts[s] = count;
        totalCount += count;
      }
    }

    const distributionPercentages = {
      strength: totalCount > 0 ? distCounts.strength / totalCount : 0.25,
      speed: totalCount > 0 ? distCounts.speed / totalCount : 0.25,
      defense: totalCount > 0 ? distCounts.defense / totalCount : 0.25,
      dexterity: totalCount > 0 ? distCounts.dexterity / totalCount : 0.25,
    };

    // 4. Fetch daily history for charts based on timeframe (7d, 30d, 90d, or all)
    const timeframe = typeof req.query.timeframe === "string" ? req.query.timeframe.toLowerCase() : "30d";
    let daysLimit = 30;
    if (timeframe === "7d") daysLimit = 7;
    else if (timeframe === "90d") daysLimit = 90;
    else if (timeframe === "all") daysLimit = 3650; // 10 years

    let daysAgoTimestamp = Math.floor(Date.now() / 1000) - daysLimit * 24 * 60 * 60;
    if (timeframe === "all") {
      daysAgoTimestamp = 0; // fetch all records
    }

    const dailyHistoryLogs = await db
      .selectFrom("sentinel_gym_train_logs" as any)
      .select([
        sql`date(timestamp, 'unixepoch', 'localtime')`.as("day"),
        "stat",
        db.fn.sum("gain").as("total_gain"),
        db.fn.sum("energy").as("total_energy"),
      ])
      .where("timestamp", ">=", daysAgoTimestamp)
      .groupBy(["day", "stat"])
      .orderBy("day", "asc")
      .execute();

    const historyMap: Record<string, any> = {};
    for (const log of dailyHistoryLogs) {
      const day = String(log.day);
      if (!historyMap[day]) {
        historyMap[day] = {
          day,
          strength: 0,
          speed: 0,
          defense: 0,
          dexterity: 0,
          energy: 0,
        };
      }
      const stat = String(log.stat).toLowerCase();
      const gain = parseFloat(String(log.total_gain || 0));
      const energy = parseInt(String(log.total_energy || 0), 10);
      if (stat === "strength") historyMap[day].strength += gain;
      else if (stat === "speed") historyMap[day].speed += gain;
      else if (stat === "defense") historyMap[day].defense += gain;
      else if (stat === "dexterity") historyMap[day].dexterity += gain;
      
      historyMap[day].energy += energy;
    }
    const history = Object.values(historyMap).sort((a: any, b: any) => a.day.localeCompare(b.day));

    // 5. Fetch sync status & metadata
    const totalLogsCount = await db
      .selectFrom("sentinel_gym_train_logs" as any)
      .select(db.fn.count("log_id").as("count"))
      .executeTakeFirst();
    const count = Number(totalLogsCount?.count || 0);

    const oldestLog = await db
      .selectFrom("sentinel_gym_train_logs" as any)
      .select("timestamp")
      .orderBy("timestamp", "asc")
      .limit(1)
      .executeTakeFirst();

    const latestLogRecord = await db
      .selectFrom("sentinel_gym_train_logs" as any)
      .select("timestamp")
      .orderBy("timestamp", "desc")
      .limit(1)
      .executeTakeFirst();

    const scheduleRow = await db
      .selectFrom("sentinel_worker_schedules")
      .innerJoin("sentinel_workers", "sentinel_worker_schedules.worker_id", "sentinel_workers.id")
      .select([
        "sentinel_worker_schedules.last_run_at as last_run_at",
        "sentinel_worker_schedules.next_run_at as next_run_at",
        "sentinel_worker_schedules.metadata as metadata"
      ])
      .where("sentinel_workers.name", "=", "torn_gyms_worker")
      .executeTakeFirst();

    let isBackfillComplete = false;
    if (scheduleRow?.metadata) {
      try {
        const parsed = JSON.parse(scheduleRow.metadata);
        if (parsed.backfill_complete) {
          isBackfillComplete = true;
        }
      } catch {}
    }

    // 6. Fetch Target Ratios and Compute Training Recommendations via shared utility
    let apiKey = process.env.TORN_API_KEY || process.env.SENTINEL_API_KEY;
    try {
      const keyRow = await db
        .selectFrom(TABLE_NAMES.SYSTEM_API_KEYS)
        .select("api_key_encrypted")
        .where("key_type", "=", "personal")
        .where("is_primary", "=", 1)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      
      if (keyRow?.api_key_encrypted && process.env.ENCRYPTION_KEY) {
        const { decryptApiKey } = await import("@sentinel/shared");
        apiKey = decryptApiKey(keyRow.api_key_encrypted, process.env.ENCRYPTION_KEY);
      }
    } catch (err) {
      console.error("[HTTP] Failed to fetch/decrypt personal API key:", err);
    }

    const { getPersonalTrainingRecommendations } = await import("../../utils/training-recommendations.js");
    const recs = await getPersonalTrainingRecommendations(String(userId), apiKey);

    // 7. Run projection for milestones (foregoing past milestones, returning only the single next target)
    const targetMilestones = [10000000, 50000000, 100000000, 250000000, 500000000, 1000000000, 2000000000];
    const statsKeys = ["strength", "speed", "defense", "dexterity"] as const;

    const projections = statsKeys.map((key) => {
      const currentVal = statsData[key];
      const baseGymMult = (activeGym[key] || 20);
      const perkPct = recs.factionPerks[key] || 0;
      const gymMult = (baseGymMult / 10) * (1 + perkPct / 100);
      const allocation = distributionPercentages[key];
      const dailyEnergyForStat = avgDailyEnergy * allocation;

      // Find the first target greater than currentVal, or default to a rounded double logic if all exceeded
      const nextMilestoneTarget = targetMilestones.find((t) => t > currentVal) || 
        (Math.ceil(currentVal / 1000000000) * 1000000000 + 1000000000);
      const filteredMilestoneTargets = [nextMilestoneTarget];

      const milestones = filteredMilestoneTargets.map((target) => {
        let days = null;
        if (target <= currentVal) {
          days = 0;
        } else if (dailyEnergyForStat > 0) {
          const happyVal = avgHappy;
          const A = 1.15 * gymMult * 10 * (3.48e-7 * Math.log(happyVal) + 3.09e-6);
          const B = 1.15 * gymMult * 10 * (6.83e-5 * happyVal - 0.03);
          
          if (A > 0) {
            const n = (1 / A) * Math.log((target + B / A) / (currentVal + B / A));
            const energyReq = n * 10;
            days = Math.max(0, energyReq / dailyEnergyForStat);
          }
        }

        return {
          target,
          days: days !== null ? Math.round(days * 10) / 10 : null,
          energy: days !== null ? Math.round(days * dailyEnergyForStat) : null,
        };
      });

      return {
        stat: key,
        currentValue: currentVal,
        allocation: Math.round(allocation * 100),
        dailyEnergy: Math.round(dailyEnergyForStat),
        milestones,
      };
    });

    res.json({
      currentStats: {
        strength: statsData.strength,
        speed: statsData.speed,
        defense: statsData.defense,
        dexterity: statsData.dexterity,
        total: statsData.total_stats,
      },
      activeGym: activeGym.name,
      avgHappy,
      maxHappy,
      currentHappy,
      avgDailyEnergy: Math.round(avgDailyEnergy),
      projections,
      history,
      syncStatus: {
        totalRecords: count,
        lastSyncAt: scheduleRow?.last_run_at || null,
        nextRunAt: scheduleRow?.next_run_at || null,
        isBackfillComplete,
        oldestLogTimestamp: oldestLog ? Number(oldestLog.timestamp) : null,
        latestLogTimestamp: latestLogRecord ? Number(latestLogRecord.timestamp) : null,
      },
      recommendation: {
        stat: recs.stat,
        statKey: recs.statKey,
        diff: recs.diff,
        text: recs.text,
        gymRecommendation: recs.gymRecommendation,
        currentEnergy: recs.currentEnergy,
        maxEnergy: recs.maxEnergy,
        factionPerks: recs.factionPerks,
        buildInfo: recs.buildInfo,
      }
    });

  } catch (error) {
    console.error("[HTTP] Error fetching milestones projection:", error);
    res.status(500).json({ error: "Server error" });
  }
});


