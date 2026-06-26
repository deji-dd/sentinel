/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { TABLE_NAMES, decryptApiKey } from "@sentinel/shared";
import { db, rawDb } from "./db-client.js";
import { tornApi } from "../services/torn-client.js";
import { Logger } from "./logger.js";
import { randomUUID } from "crypto";
import { logGuildAction } from "./guild-logger.js";
import { postContractReport } from "./mercenary-reporter.js";

const logger = new Logger("MercenaryTracker");
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required");
}

const lastFactionPolls = new Map<string, number>();

function getAttackVerb(result: string): string {
  const resLower = (result || "").toLowerCase();
  if (resLower === "hospitalized") return "hospitalized";
  if (resLower === "mugged") return "mugged";
  if (resLower === "attacked" || resLower === "special") return "left";
  return resLower || "hit";
}

function getRequiredActionName(contractType: string): string {
  const tLower = (contractType || "").toLowerCase();
  if (tLower === "hospitalize" || tLower === "hosp") return "a hospitalize";
  if (tLower === "leave") return "a leave";
  if (tLower === "mug") return "a mug";
  return tLower || "a hit";
}

function parseDbDate(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  let formatted = dateStr;
  if (
    !dateStr.endsWith("Z") &&
    !dateStr.includes("+") &&
    !dateStr.includes("GMT")
  ) {
    formatted = dateStr.replace(" ", "T") + "Z";
  }
  return new Date(formatted).getTime();
}

export async function runMercenaryTrackerGuildSync(
  client: Client,
  guildId: string,
): Promise<void> {
  try {
    // 1. Ensure the message_id and channel_id columns exist on sentinel_mercenary_targets
    try {
      rawDb
        .prepare(
          "ALTER TABLE sentinel_mercenary_targets ADD COLUMN message_id TEXT",
        )
        .run();
    } catch {
      // Column already exists, safe to ignore
    }
    try {
      rawDb
        .prepare(
          "ALTER TABLE sentinel_mercenary_targets ADD COLUMN channel_id TEXT",
        )
        .run();
    } catch {
      // Column already exists, safe to ignore
    }

    // 2. Expire old dibs claims (Time-based automatic expiration disabled per user request)

    const nowIso = new Date().toISOString();

    // 3a. Automatically complete expired contracts
    const expiringContracts = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
      .select("id")
      .where("guild_id", "=", guildId)
      .where("status", "=", "active")
      .where("ends_at", "is not", null)
      .where("ends_at", "<", nowIso)
      .execute();

    if (expiringContracts.length > 0) {
      const expiringIds = expiringContracts
        .map((c) => c.id)
        .filter(Boolean) as string[];

      await db
        .updateTable(TABLE_NAMES.MERCENARY_CONTRACTS)
        .set({
          status: "completed",
          closed_at: nowIso,
          updated_at: nowIso,
        })
        .where("id", "in", expiringIds)
        .execute();

      for (const contractId of expiringIds) {
        try {
          await postContractReport(client, contractId, guildId);
        } catch (reportErr) {
          logger.error(
            `Error sending completion report for expired contract ${contractId}:`,
            reportErr,
          );
        }
      }
    }

    // 3b. Fetch active contracts that have started and not ended
    const activeContracts = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("status", "=", "active")
      .where((eb) =>
        eb.and([
          eb.or([eb("start_at", "is", null), eb("start_at", "<=", nowIso)]),
          eb.or([eb("ends_at", "is", null), eb("ends_at", ">", nowIso)]),
        ]),
      )
      .execute();

    const activeContractIds = new Set(activeContracts.map((c) => c.id));

    // 4. Fetch mercenary config for channel IDs
    const config = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    // Clean up inactive/paused/completed/cancelled/deleted contracts messages
    const allTrackedTargets = await db
      .selectFrom(TABLE_NAMES.MERCENARY_TARGETS)
      .selectAll()
      .execute();

    for (const record of allTrackedTargets) {
      if (!activeContractIds.has(record.contract_id)) {
        if (record.message_id && config?.hit_post_channel_id) {
          const channel = await client.channels
            .fetch(config.hit_post_channel_id)
            .catch(() => null);
          if (channel?.isTextBased()) {
            const msg = await channel.messages
              .fetch(record.message_id)
              .catch(() => null);
            if (msg) await msg.delete().catch(() => null);
          }
        }
        await db
          .deleteFrom(TABLE_NAMES.MERCENARY_TARGETS)
          .where("id", "=", record.id)
          .execute();
      }
    }

    const allTrackedPops = await db
      .selectFrom(TABLE_NAMES.MERCENARY_POPULATIONS)
      .selectAll()
      .where("guild_id", "=", guildId)
      .execute();

    for (const pop of allTrackedPops) {
      if (!activeContractIds.has(pop.contract_id)) {
        if (pop.message_id && config?.hit_post_channel_id) {
          const channel = await client.channels
            .fetch(config.hit_post_channel_id)
            .catch(() => null);
          if (channel?.isTextBased()) {
            const msg = await channel.messages
              .fetch(pop.message_id)
              .catch(() => null);
            if (msg) await msg.delete().catch(() => null);
          }
        }
        await db
          .deleteFrom(TABLE_NAMES.MERCENARY_POPULATIONS)
          .where("id", "=", pop.id)
          .execute();
      }
    }

    if (activeContracts.length === 0) {
      return;
    }

    if (!config || !config.hit_post_channel_id) {
      logger.warn(`No hit posting channel configured for guild ${guildId}`);
      return;
    }

    // Get dibs config
    const dibsConfig = await db
      .selectFrom(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    // 5. Fetch active registered mercenary keys
    const registeredMercs = await db
      .selectFrom(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
      .select(["api_key", "discord_id", "torn_id", "torn_name"])
      .where("guild_id", "=", guildId)
      .where("is_active", "=", 1)
      .execute();

    const apiKeys = registeredMercs
      .map((m) => {
        try {
          return m.api_key ? decryptApiKey(m.api_key, ENCRYPTION_KEY) : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as string[];

    // Fallback to primary guild API key if no merc keys
    if (apiKeys.length === 0) {
      const primaryKeyRow = await db
        .selectFrom(TABLE_NAMES.GUILD_API_KEYS)
        .select(["api_key_encrypted"])
        .where("guild_id", "=", guildId)
        .where("is_primary", "=", 1)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (primaryKeyRow) {
        try {
          const primaryKey = decryptApiKey(
            primaryKeyRow.api_key_encrypted,
            ENCRYPTION_KEY,
          );
          if (primaryKey) apiKeys.push(primaryKey);
        } catch {
          // Decryption failed, skip key
        }
      }
    }

    if (apiKeys.length === 0) {
      logger.warn(
        `No valid API keys available for target tracking in guild ${guildId}`,
      );
      return;
    }

    let keyIndex = 0;
    const getApiKey = () => {
      const key = apiKeys[keyIndex % apiKeys.length];
      keyIndex++;
      return key;
    };

    // Fetch primary API key explicitly for faction attacks polling
    let primaryApiKey: string | null = null;
    const primaryKeyRowForPoll = await db
      .selectFrom(TABLE_NAMES.GUILD_API_KEYS)
      .select(["api_key_encrypted"])
      .where("guild_id", "=", guildId)
      .where("is_primary", "=", 1)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (primaryKeyRowForPoll) {
      try {
        primaryApiKey = decryptApiKey(
          primaryKeyRowForPoll.api_key_encrypted,
          ENCRYPTION_KEY,
        );
      } catch {
        // Decryption failed, skip key
      }
    }

    const pollKey = primaryApiKey || apiKeys[0];
    let attacksList: any[] = [];
    if (pollKey && activeContracts.length > 0) {
      const now = Date.now();
      const lastPoll = lastFactionPolls.get(guildId) || 0;
      if (now - lastPoll >= 20000) {
        // 20s throttle
        lastFactionPolls.set(guildId, now);
        try {
          let earliestStart = Date.now();
          for (const contract of activeContracts) {
            const start = parseDbDate(contract.start_at || contract.created_at);
            if (start < earliestStart) {
              earliestStart = start;
            }
          }
          const fromTimestamp = Math.floor(earliestStart / 1000);

          logger.info(
            `Polling client faction attacks for guild ${guildId} from timestamp ${fromTimestamp}`,
          );
          const factionAttacksRes = await tornApi.get("/faction/attacks", {
            apiKey: pollKey,
            queryParams: {
              filters: ["outgoing"],
              sort: "desc",
              limit: 100,
              from: fromTimestamp,
            },
          });
          attacksList = (factionAttacksRes.attacks || []) as any[];
          logger.info(
            `Fetched ${attacksList.length} faction attacks for guild ${guildId}`,
          );
        } catch (err) {
          logger.error(
            `Error polling faction attacks for guild ${guildId}:`,
            err,
          );
        }
      }
    }

    const channel = await client.channels
      .fetch(config.hit_post_channel_id)
      .catch(() => null);
    if (!channel || !channel.isTextBased()) {
      logger.warn(
        `Configured hit posting channel ${config.hit_post_channel_id} is invalid or inaccessible`,
      );
      return;
    }

    for (const contract of activeContracts) {
      if (!contract.id || !contract.faction_id) continue;

      try {
        const apiKey = getApiKey();
        if (!apiKey) continue;

        const factionDb = await db
          .selectFrom(TABLE_NAMES.TORN_FACTIONS)
          .select("tag_image")
          .where("id", "=", contract.faction_id)
          .executeTakeFirst();
        const factionTagImage = factionDb?.tag_image || null;

        // Fetch wars from Torn API to check both ranked and territory wars
        const warsResponse = await tornApi.get("/faction/{id}/wars", {
          apiKey,
          pathParams: { id: String(contract.faction_id) },
        });

        let inWar = false;
        let upcomingWarStartTime: string | null = null;

        const ranked = warsResponse.wars?.ranked;
        if (ranked && ranked.war_id > 0) {
          const startTime = ranked.start * 1000;
          if (startTime <= Date.now() && !ranked.end) {
            inWar = true;
          } else if (startTime > Date.now()) {
            upcomingWarStartTime = new Date(startTime).toISOString();
          }
        }

        const territoryWars = warsResponse.wars?.territory || [];
        for (const tw of territoryWars) {
          if (tw.war_id > 0) {
            const startTime = tw.start * 1000;
            if (startTime <= Date.now() && !tw.end) {
              inWar = true;
            } else if (
              startTime > Date.now() &&
              (!upcomingWarStartTime ||
                new Date(startTime).toISOString() < upcomingWarStartTime)
            ) {
              upcomingWarStartTime = new Date(startTime).toISOString();
            }
          }
        }

        const wasInWar = contract.in_war === 1;

        if (inWar !== wasInWar) {
          await db
            .updateTable(TABLE_NAMES.MERCENARY_CONTRACTS)
            .set({
              in_war: inWar ? 1 : 0,
              war_start_at: inWar
                ? new Date().toISOString()
                : contract.war_start_at,
              updated_at: new Date().toISOString(),
            })
            .where("id", "=", contract.id)
            .execute();
          contract.in_war = inWar ? 1 : 0;
        }

        // Fetch members
        const membersResponse = await tornApi.get("/faction/{id}/members", {
          apiKey,
          pathParams: { id: String(contract.faction_id) },
        });

        const members = (membersResponse.members || []) as any[];

        // --- Process Faction-Wide Attacks (Polled globally) ---
        if (attacksList && attacksList.length > 0) {
          // Get existing hits in vault to avoid duplicate inserts
          const existingHits = await db
            .selectFrom(TABLE_NAMES.MERCENARY_VERIFICATION_VAULT)
            .select("attack_id")
            .where("contract_id", "=", contract.id)
            .execute();
          const existingAttackIds = new Set(
            existingHits.map((h) => h.attack_id).filter(Boolean),
          );

          // Get active dibs claims for this contract
          const activeDibsForContract = await db
            .selectFrom(TABLE_NAMES.MERCENARY_DIBS)
            .selectAll()
            .where("contract_id", "=", contract.id)
            .where("status", "=", "active")
            .execute();

          let targetRoles: string[] = [];
          if (contract.target_roles_json) {
            try {
              const parsed = JSON.parse(contract.target_roles_json);
              if (Array.isArray(parsed)) targetRoles = parsed;
            } catch {
              // Invalid JSON in target_roles_json, use empty array
            }
          }

          for (const attack of attacksList) {
            const attackId =
              attack.code || String(attack.timestamp_ended || attack.ended);
            if (existingAttackIds.has(attackId)) continue;

            const attacker = attack.attacker;
            const defender = attack.defender;
            if (!attacker || !defender) continue;

            // Check if attacker is a registered mercenary
            const merc = registeredMercs.find(
              (m) => String(m.torn_id) === String(attacker.id),
            );
            if (!merc) continue;

            // Check if defender is a member of the target faction
            const targetMember = members.find(
              (m) => String(m.id) === String(defender.id),
            );
            if (!targetMember) continue;

            // Validate level
            if (
              contract.min_level !== null &&
              defender.level < contract.min_level
            )
              continue;
            if (
              contract.max_level !== null &&
              defender.level > contract.max_level
            )
              continue;

            // Validate role/position
            if (targetRoles.length > 0) {
              if (!targetRoles.includes(targetMember.position)) continue;
            }

            // Validate time limits
            const endedSec = attack.timestamp_ended || attack.ended;
            const endedTimestamp = endedSec ? endedSec * 1000 : 0;
            const effectiveStart = contract.start_at || contract.created_at;
            if (effectiveStart && parseDbDate(effectiveStart) > endedTimestamp)
              continue;
            if (
              contract.ends_at &&
              parseDbDate(contract.ends_at) < endedTimestamp
            )
              continue;

            const resLower = (attack.result || "").toLowerCase();
            const contractType = (contract.contract_type || "").toLowerCase();

            let isMatch = false;
            if (contractType === "hospitalize" || contractType === "hosp") {
              isMatch = resLower === "hospitalized";
            } else if (contractType === "leave") {
              isMatch = resLower === "attacked" || resLower === "special";
            } else if (contractType === "mug") {
              isMatch = resLower === "mugged";
            } else {
              isMatch = [
                "hospitalized",
                "attacked",
                "special",
                "mugged",
              ].includes(resLower);
            }

            if (!isMatch) {
              // Record invalid hit in vault to prevent duplicate alerts
              const verificationId = randomUUID();
              await db
                .insertInto(TABLE_NAMES.MERCENARY_VERIFICATION_VAULT)
                .values({
                  id: verificationId,
                  contract_id: contract.id,
                  target_id: null,
                  merc_discord_id: merc.discord_id,
                  merc_torn_id: String(merc.torn_id),
                  merc_name: merc.torn_name,
                  attacker_torn_id: String(attacker.id),
                  attacker_name: attacker.name,
                  defender_torn_id: String(defender.id),
                  defender_name: defender.name,
                  attack_id: attackId,
                  attack_type: attack.result,
                  result: "invalid_type",
                  payout_status: "ignored",
                  payout_amount: 0,
                  occurred_at: new Date(endedTimestamp).toISOString(),
                  verified_at: new Date().toISOString(),
                  verified_by: "system",
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .execute();

              await logGuildAction(guildId, client, {
                title: "Invalid Result",
                description: `<@${merc.discord_id}> successfully ${getAttackVerb(attack.result)} **${defender.name}** [${defender.id}] but the contract requires ${getRequiredActionName(contract.contract_type)}!`,
              });
              continue;
            }

            // Link verified hits to automatically complete active dibs claims
            const matchingClaim = activeDibsForContract.find(
              (d) =>
                String(d.target_torn_id) === String(defender.id) &&
                d.merc_discord_id === merc.discord_id,
            );

            if (matchingClaim) {
              await db
                .updateTable(TABLE_NAMES.MERCENARY_DIBS)
                .set({
                  status: "completed",
                  completed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .where("id", "=", matchingClaim.id)
                .execute();
            }

            // Record hit in vault with the locked-in pay rate
            const verificationId = randomUUID();
            await db
              .insertInto(TABLE_NAMES.MERCENARY_VERIFICATION_VAULT)
              .values({
                id: verificationId,
                contract_id: contract.id,
                target_id: null,
                merc_discord_id: merc.discord_id,
                merc_torn_id: String(merc.torn_id),
                merc_name: merc.torn_name,
                attacker_torn_id: String(attacker.id),
                attacker_name: attacker.name,
                defender_torn_id: String(defender.id),
                defender_name: defender.name,
                attack_id: attackId,
                attack_type: attack.result,
                result: "verified",
                payout_status: "pending",
                payout_amount: contract.pay_amount || 0,
                occurred_at: new Date(endedTimestamp).toISOString(),
                verified_at: new Date().toISOString(),
                verified_by: "system",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .execute();

            await logGuildAction(guildId, client, {
              title: "Verified Faction Log",
              description: `<@${merc.discord_id}> successfully ${getAttackVerb(attack.result)} **${defender.name}** [${defender.id}]!\nPayout recorded: **$${(contract.pay_amount || 0).toLocaleString()}**`,
            });
          }
        }

        // --- Active Claims Verification Loop ---
        const activeClaims = await db
          .selectFrom(TABLE_NAMES.MERCENARY_DIBS)
          .selectAll()
          .where("contract_id", "=", contract.id)
          .where("status", "=", "active")
          .execute();

        for (const claim of activeClaims) {
          // 2. Look up target status in faction members list
          const targetMember = members.find(
            (m) => String(m.id) === String(claim.target_torn_id),
          );
          if (!targetMember) {
            // Target left the faction or no longer in members list -> release claim
            await db
              .updateTable(TABLE_NAMES.MERCENARY_DIBS)
              .set({ status: "released", updated_at: new Date().toISOString() })
              .where("id", "=", claim.id)
              .execute();

            await logGuildAction(guildId, client, {
              title: "Mercenary Dibs Released",
              description: `Claim on target **${claim.target_name}** [${claim.target_torn_id}] was released because target is no longer in the faction.`,
            });
            continue;
          }

          // 3. Check if target is in the hospital
          if (targetMember.status?.state === "Hospital") {
            logger.info(
              `Target ${claim.target_name} [${claim.target_torn_id}] is in hospital. Verifying claimant's attack logs.`,
            );

            // Retrieve the claimant's registered API key
            const registeredMerc = await db
              .selectFrom(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
              .selectAll()
              .where("guild_id", "=", guildId)
              .where("discord_id", "=", claim.merc_discord_id)
              .where("is_active", "=", 1)
              .executeTakeFirst();

            let verified = false;
            let matchedAttack: any = null;

            if (registeredMerc && registeredMerc.api_key) {
              try {
                const mercApiKey = decryptApiKey(
                  registeredMerc.api_key,
                  ENCRYPTION_KEY,
                );

                const claimStartTimestamp = Math.floor(
                  parseDbDate(claim.claimed_at!) / 1000,
                );

                // Call Torn API to get claimant's attacks (simplified type is outgoing)
                const attacksResponse = await tornApi.get("/user/attacks", {
                  apiKey: mercApiKey,
                  queryParams: {
                    from: claimStartTimestamp,
                  },
                });

                const attacksObj = (attacksResponse as any).attacks || {};
                const attacksList = Object.values(attacksObj) as any[];

                for (const attack of attacksList) {
                  const attackEndTimestamp = attack.timestamp_ended;
                  if (
                    String(attack.defender_id) ===
                      String(claim.target_torn_id) &&
                    attackEndTimestamp >= claimStartTimestamp
                  ) {
                    // Check if attacker won and result matches contract requirements
                    // contract_type: "hospitalize", "leave", "mug", "any"/"mixed"
                    // attack.result mapping:
                    // - "Hospitalized" -> hospitalize
                    // - "Attacked", "Special" -> leave
                    // - "Mugged" -> mug
                    const resLower = (attack.result || "").toLowerCase();
                    const contractType = (
                      contract.contract_type || ""
                    ).toLowerCase();

                    let isMatch = false;
                    if (contractType === "hospitalize") {
                      isMatch = resLower === "hospitalized";
                    } else if (contractType === "leave") {
                      isMatch =
                        resLower === "attacked" || resLower === "special";
                    } else if (contractType === "mug") {
                      isMatch = resLower === "mugged";
                    } else {
                      // mixed, any, or unrecognized - count any winning result
                      isMatch = [
                        "hospitalized",
                        "attacked",
                        "special",
                        "mugged",
                      ].includes(resLower);
                    }

                    if (isMatch) {
                      verified = true;
                      matchedAttack = attack;
                      break;
                    }
                  }
                }
              } catch (apiErr) {
                logger.error(
                  `Error querying attack logs for mercenary <@${claim.merc_discord_id}>:`,
                  apiErr,
                );
              }
            }

            if (verified && matchedAttack) {
              // Mark claim as completed
              await db
                .updateTable(TABLE_NAMES.MERCENARY_DIBS)
                .set({
                  status: "completed",
                  completed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .where("id", "=", claim.id)
                .execute();

              // Insert record into verification vault
              const verificationId = randomUUID();
              await db
                .insertInto(TABLE_NAMES.MERCENARY_VERIFICATION_VAULT)
                .values({
                  id: verificationId,
                  contract_id: contract.id,
                  target_id: null,
                  merc_discord_id: claim.merc_discord_id,
                  merc_torn_id: registeredMerc?.torn_id
                    ? String(registeredMerc.torn_id)
                    : null,
                  merc_name: registeredMerc?.torn_name || null,
                  attacker_torn_id: registeredMerc?.torn_id
                    ? String(registeredMerc.torn_id)
                    : null,
                  attacker_name: registeredMerc?.torn_name || null,
                  defender_torn_id: String(claim.target_torn_id),
                  defender_name: claim.target_name,
                  attack_id:
                    matchedAttack.code || String(matchedAttack.timestamp_ended),
                  attack_type: matchedAttack.result,
                  result: "verified",
                  payout_status: "pending",
                  payout_amount: contract.pay_amount || 0,
                  occurred_at: new Date(
                    matchedAttack.timestamp_ended * 1000,
                  ).toISOString(),
                  verified_at: new Date().toISOString(),
                  verified_by: "system",
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .execute();

              await logGuildAction(guildId, client, {
                title: "Verified Faction Log",
                description: `<@${claim.merc_discord_id}> successfully ${getAttackVerb(matchedAttack.result)} **${claim.target_name}** [${claim.target_torn_id}]!\nPayout recorded: **$${(contract.pay_amount || 0).toLocaleString()}**`,
              });
            }
          } else if (
            targetMember.status?.state === "Abroad" ||
            targetMember.status?.state === "Jail"
          ) {
            // 4. Check if target went abroad or jail
            await db
              .updateTable(TABLE_NAMES.MERCENARY_DIBS)
              .set({ status: "released", updated_at: new Date().toISOString() })
              .where("id", "=", claim.id)
              .execute();

            await logGuildAction(guildId, client, {
              title: "Mercenary Dibs Released",
              description: `Claim on target **${claim.target_name}** [${claim.target_torn_id}] by <@${claim.merc_discord_id}> was released because target went ${targetMember.status.state}.`,
            });
          }
        }

        // Extract target roles filters
        let targetRoles: string[] = [];
        if (contract.target_roles_json) {
          try {
            const parsed = JSON.parse(contract.target_roles_json);
            if (Array.isArray(parsed)) targetRoles = parsed;
          } catch {
            // Invalid JSON in target_roles_json, use empty array
          }
        }

        // Fetch active claims
        const activeDibs = await db
          .selectFrom(TABLE_NAMES.MERCENARY_DIBS)
          .selectAll()
          .where("contract_id", "=", contract.id)
          .where("status", "=", "active")
          .execute();

        const upcomingTargets: any[] = [];
        const dibsTargets: any[] = [];
        const okayTargets: any[] = [];
        const dibsGroupTornIds = new Set<string>();

        const limit = Number(dibsConfig?.dibs_remaining_minutes ?? 15);

        for (const member of members) {
          // Exclude jail/abroad
          if (
            member.status?.state === "Abroad" ||
            member.status?.state === "Jail"
          ) {
            continue;
          }

          // 1. Level filter
          if (contract.min_level !== null && member.level < contract.min_level)
            continue;
          if (contract.max_level !== null && member.level > contract.max_level)
            continue;

          // 2. Position/Role filter
          if (targetRoles.length > 0) {
            if (!targetRoles.includes(member.position)) continue;
          }

          // 3. Scope / Status filter
          const lastActionStatus = member.last_action?.status;
          const awayMinutes = member.last_action?.timestamp
            ? Math.floor(
                (Date.now() - member.last_action.timestamp * 1000) / 60000,
              )
            : 0;

          let matchesScope = true;
          if (contract.target_scope === "offline_only") {
            if (lastActionStatus !== "Offline") matchesScope = false;
            if (
              contract.idle_minutes !== null &&
              awayMinutes < contract.idle_minutes
            )
              matchesScope = false;
          } else if (contract.target_scope === "offline_and_idle") {
            const isOfflineOrIdle =
              lastActionStatus === "Offline" || lastActionStatus === "Idle";
            if (!isOfflineOrIdle) matchesScope = false;
            if (
              contract.idle_minutes !== null &&
              awayMinutes < contract.idle_minutes
            )
              matchesScope = false;
          }

          if (!matchesScope) continue;

          // Check claim status
          const claim = activeDibs.find(
            (d) => String(d.target_torn_id) === String(member.id),
          );

          if (member.status?.state === "Hospital") {
            const nowSeconds = Math.floor(Date.now() / 1000);
            const hospitalTimeLeftMinutes = member.status.until
              ? Math.max(0, Math.floor((member.status.until - nowSeconds) / 60))
              : 0;

            if (claim || hospitalTimeLeftMinutes <= limit) {
              dibsTargets.push({
                ...member,
                claimed_by: claim?.merc_discord_id || null,
              });
              dibsGroupTornIds.add(String(member.id));
            } else if (hospitalTimeLeftMinutes <= limit * 1.5) {
              upcomingTargets.push(member);
            }
          } else {
            // Target is Okay
            if (claim) {
              dibsTargets.push({
                ...member,
                claimed_by: claim.merc_discord_id,
              });
              dibsGroupTornIds.add(String(member.id));
            } else {
              okayTargets.push(member);
            }
          }
        }

        // --- 1. Update UPCOMING DIBS Summary Display (Top of channel) ---
        const upcomingListText =
          upcomingTargets.length > 0
            ? upcomingTargets
                .slice(0, 20)
                .map((m) => {
                  const untilSec = m.status?.until || 0;
                  return `• [**${m.name}**](https://www.torn.com/profiles.php?XID=${m.id}) [${m.id}] • lvl ${m.level} • out <t:${untilSec}:R>`;
                })
                .join("\n")
            : "No upcoming targets currently.";

        const upcomingEmbed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle(`Upcoming Targets`)
          .setDescription(upcomingListText)
          .setTimestamp();

        if (upcomingTargets.length > 20) {
          upcomingEmbed.addFields({
            name: "Remaining Targets",
            value: `...and ${upcomingTargets.length - 20} more targets not listed.`,
          });
        }

        const upcomingPop = await db
          .selectFrom(TABLE_NAMES.MERCENARY_POPULATIONS)
          .selectAll()
          .where("contract_id", "=", contract.id)
          .where("population_type", "=", "upcoming_dibs")
          .executeTakeFirst();

        let upcomingMsgId: string | null = null;
        if (upcomingPop?.message_id) {
          const msg = await channel.messages
            .fetch(upcomingPop.message_id)
            .catch(() => null);
          if (msg) {
            await msg.edit({ embeds: [upcomingEmbed] }).catch(() => {});
            upcomingMsgId = msg.id;
          }
        }

        if (!upcomingMsgId) {
          const newMsg = await channel
            .send({ embeds: [upcomingEmbed] })
            .catch(() => null);
          if (newMsg) {
            const popId = upcomingPop?.id || randomUUID();
            await db
              .insertInto(TABLE_NAMES.MERCENARY_POPULATIONS)
              .values({
                id: popId,
                contract_id: contract.id,
                guild_id: guildId,
                population_type: "upcoming_dibs",
                target_count: upcomingTargets.length,
                channel_id: config.hit_post_channel_id,
                message_id: newMsg.id,
                posted_at: new Date().toISOString(),
              })
              .onConflict((oc) =>
                oc.column("id").doUpdateSet({
                  target_count: upcomingTargets.length,
                  message_id: newMsg.id,
                  posted_at: new Date().toISOString(),
                }),
              )
              .execute();
          }
        } else {
          await db
            .updateTable(TABLE_NAMES.MERCENARY_POPULATIONS)
            .set({
              target_count: upcomingTargets.length,
              posted_at: new Date().toISOString(),
            })
            .where("id", "=", upcomingPop!.id)
            .execute();
        }

        // --- 2. Update CURRENT CLAIMS Summary Display (Middle of channel) ---
        const claimsListText =
          activeDibs.length > 0
            ? activeDibs
                .map(
                  (d) =>
                    `• **${d.target_name}** [${d.target_torn_id}] claimed by <@${d.merc_discord_id}> (Expires <t:${Math.floor(parseDbDate(d.expires_at!) / 1000)}:R>) · [Attack](https://www.torn.com/page.php?sid=attack&user2ID=${d.target_torn_id})`,
                )
                .join("\n")
            : "No active claims.";

        const claimsEmbed = new EmbedBuilder()
          .setColor(0x10b981)
          .setTitle(`Claimed Targets`)
          .setDescription(claimsListText)
          .setTimestamp();

        const claimsPop = await db
          .selectFrom(TABLE_NAMES.MERCENARY_POPULATIONS)
          .selectAll()
          .where("contract_id", "=", contract.id)
          .where("population_type", "=", "current_claims")
          .executeTakeFirst();

        let claimsMsgId: string | null = null;
        if (claimsPop?.message_id) {
          const msg = await channel.messages
            .fetch(claimsPop.message_id)
            .catch(() => null);
          if (msg) {
            await msg.edit({ embeds: [claimsEmbed] }).catch(() => {});
            claimsMsgId = msg.id;
          }
        }

        if (!claimsMsgId) {
          const newMsg = await channel
            .send({ embeds: [claimsEmbed] })
            .catch(() => null);
          if (newMsg) {
            const popId = claimsPop?.id || randomUUID();
            await db
              .insertInto(TABLE_NAMES.MERCENARY_POPULATIONS)
              .values({
                id: popId,
                contract_id: contract.id,
                guild_id: guildId,
                population_type: "current_claims",
                target_count: activeDibs.length,
                channel_id: config.hit_post_channel_id,
                message_id: newMsg.id,
                posted_at: new Date().toISOString(),
              })
              .onConflict((oc) =>
                oc.column("id").doUpdateSet({
                  target_count: activeDibs.length,
                  message_id: newMsg.id,
                  posted_at: new Date().toISOString(),
                }),
              )
              .execute();
          }
        } else {
          await db
            .updateTable(TABLE_NAMES.MERCENARY_POPULATIONS)
            .set({
              target_count: activeDibs.length,
              posted_at: new Date().toISOString(),
            })
            .where("id", "=", claimsPop!.id)
            .execute();
        }

        // --- 3. Update Individual Target Messages for Claims (Bottom of channel) ---
        const existingTargetMessages = await db
          .selectFrom(TABLE_NAMES.MERCENARY_TARGETS)
          .selectAll()
          .where("contract_id", "=", contract.id)
          .where("status", "=", "active")
          .execute();

        const existingMsgMap = new Map<
          string,
          (typeof existingTargetMessages)[0]
        >();
        for (const record of existingTargetMessages) {
          if (record.target_torn_id) {
            const key = String(record.target_torn_id);
            if (existingMsgMap.has(key)) {
              // Delete duplicate message and DB row aggressively
              if (record.message_id) {
                const msg = await channel.messages
                  .fetch(record.message_id)
                  .catch(() => null);
                if (msg) await msg.delete().catch(() => null);
              }
              await db
                .deleteFrom(TABLE_NAMES.MERCENARY_TARGETS)
                .where("id", "=", record.id)
                .execute();
            } else {
              existingMsgMap.set(key, record);
            }
          }
        }

        for (const m of dibsTargets) {
          const record = existingMsgMap.get(String(m.id));

          const nameLink = `[${m.name}](https://www.torn.com/profiles.php?XID=${m.id})`;
          const claimedByText = m.claimed_by ? `<@${m.claimed_by}>` : "None";
          const releasedText = m.status?.until
            ? `<t:${m.status.until}:R> (<t:${m.status.until}:t>)`
            : "Out";

          let xanText = "Loading...";
          let cansText = "Loading...";
          let enhancersText = "Loading...";
          let newStatsJson: string | null = null;

          let cachedStats: {
            xan: number;
            cans: number;
            enhancers: number;
          } | null = null;
          if (record?.notes) {
            try {
              cachedStats = JSON.parse(record.notes);
            } catch {
              // Invalid cached stats JSON, will re-fetch
            }
          }

          if (cachedStats) {
            xanText = cachedStats.xan.toLocaleString();
            cansText = cachedStats.cans.toLocaleString();
            enhancersText = cachedStats.enhancers.toLocaleString();
          } else {
            try {
              const statsResponse = await tornApi.get(
                "/user/{id}/personalstats",
                {
                  apiKey: getApiKey(),
                  pathParams: { id: String(m.id) },
                  queryParams: {
                    stat: ["xantaken", "energydrinkused", "statenhancersused"],
                  },
                },
              );
              const ps = statsResponse.personalstats;
              if (Array.isArray(ps)) {
                const xanVal =
                  ps.find((s: any) => s.name === "xantaken")?.value ?? 0;
                const cansVal =
                  ps.find((s: any) => s.name === "energydrinkused")?.value ?? 0;
                const enhancersVal =
                  ps.find((s: any) => s.name === "statenhancersused")?.value ??
                  0;
                cachedStats = {
                  xan: xanVal,
                  cans: cansVal,
                  enhancers: enhancersVal,
                };
                xanText = xanVal.toLocaleString();
                cansText = cansVal.toLocaleString();
                enhancersText = enhancersVal.toLocaleString();
                newStatsJson = JSON.stringify(cachedStats);
              }
            } catch (err) {
              logger.error(
                `Failed to fetch personal stats for target ${m.id}:`,
                err,
              );
            }
          }

          const iconURL = factionTagImage
            ? `https://factiontags.torn.com/${factionTagImage}`
            : `https://factionimages.torn.com/${contract.faction_id}`;

          const authorName = `${contract.faction_name || "Unknown Faction"} • Dibs Target`;

          const targetEmbed = new EmbedBuilder()
            .setAuthor({
              name: authorName,
              iconURL,
            })
            .setDescription(
              `**Name**: ${nameLink}\n` +
                `**Level**: ${m.level}\n` +
                `**Released**: ${releasedText}\n` +
                `**Claimed By**: ${claimedByText}\n\n` +
                `**Personal Stats**\n` +
                `• **Xanax Taken**: ${xanText}\n` +
                `• **Energy Cans**: ${cansText}\n` +
                `• **Enhancers Used**: ${enhancersText}`,
            )
            .setColor(m.claimed_by ? 0xef4444 : 0x3b82f6)
            .setFooter({ text: "Sentinel" })
            .setTimestamp();

          const claimButton = new ButtonBuilder()
            .setCustomId(`merc_claim_direct_${contract.id}_${m.id}_${m.name}`)
            .setLabel(m.claimed_by ? "Claimed" : "Claim")
            .setStyle(
              m.claimed_by ? ButtonStyle.Secondary : ButtonStyle.Primary,
            )
            .setDisabled(!!m.claimed_by);

          const attackButton = new ButtonBuilder()
            .setLabel("Attack")
            .setStyle(ButtonStyle.Link)
            .setURL(`https://www.torn.com/page.php?sid=attack&user2ID=${m.id}`);

          const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            claimButton,
            attackButton,
          );

          let messageId: string | null = null;

          if (record?.message_id) {
            const msg = await channel.messages
              .fetch(record.message_id)
              .catch(() => null);
            if (msg) {
              await msg
                .edit({
                  embeds: [targetEmbed],
                  components: [buttonRow],
                })
                .catch(() => {});
              messageId = msg.id;

              if (newStatsJson) {
                await db
                  .updateTable(TABLE_NAMES.MERCENARY_TARGETS)
                  .set({
                    notes: newStatsJson,
                    updated_at: new Date().toISOString(),
                  })
                  .where("id", "=", record.id)
                  .execute();
              }
            }
          }

          if (!messageId) {
            const newMsg = await channel
              .send({
                embeds: [targetEmbed],
                components: [buttonRow],
              })
              .catch(() => null);

            if (newMsg) {
              if (record) {
                await db
                  .updateTable(TABLE_NAMES.MERCENARY_TARGETS)
                  .set({
                    message_id: newMsg.id,
                    channel_id: config.hit_post_channel_id,
                    notes: newStatsJson || record.notes,
                    updated_at: new Date().toISOString(),
                  })
                  .where("id", "=", record.id)
                  .execute();
              } else {
                await db
                  .insertInto(TABLE_NAMES.MERCENARY_TARGETS)
                  .values({
                    id: randomUUID(),
                    contract_id: contract.id,
                    target_torn_id: String(m.id),
                    target_name: m.name,
                    faction_id: String(contract.faction_id),
                    target_type: "user",
                    status: "active",
                    is_valid: 1,
                    priority: 0,
                    message_id: newMsg.id,
                    channel_id: config.hit_post_channel_id,
                    notes: newStatsJson,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  })
                  .execute();
              }
            }
          }
        }

        // Clean up target messages for targets no longer eligible or now claimed
        for (const record of existingTargetMessages) {
          if (
            !record.target_torn_id ||
            !dibsGroupTornIds.has(String(record.target_torn_id))
          ) {
            if (record.message_id) {
              const msg = await channel.messages
                .fetch(record.message_id)
                .catch(() => null);
              if (msg) {
                await msg.delete().catch(() => null);
              }
            }
            await db
              .deleteFrom(TABLE_NAMES.MERCENARY_TARGETS)
              .where("id", "=", record.id)
              .execute();
          }
        }

        // --- 4. Update Okay/FFA paginated targets listing ---
        const prewarPop = await db
          .selectFrom(TABLE_NAMES.MERCENARY_POPULATIONS)
          .selectAll()
          .where("contract_id", "=", contract.id)
          .where("population_type", "=", "prewar")
          .executeTakeFirst();

        let currentPage = 0;
        if (prewarPop?.message_id) {
          const msg = await channel.messages
            .fetch(prewarPop.message_id)
            .catch(() => null);
          if (msg) {
            const nextButton = msg.components
              .flatMap((row) => row.components)
              .find(
                (btn) =>
                  btn.customId?.startsWith("merc_page_next_") ||
                  btn.customId?.startsWith("merc_page_prev_"),
              );
            if (nextButton && nextButton.customId) {
              const parts = nextButton.customId.split("_");
              const pageNum = parseInt(parts[parts.length - 1], 10);
              if (!isNaN(pageNum)) {
                currentPage = pageNum;
              }
            }
          }
        }

        const totalPages = Math.ceil(okayTargets.length / 10) || 1;
        if (currentPage >= totalPages) {
          currentPage = totalPages - 1;
        }
        if (currentPage < 0) {
          currentPage = 0;
        }

        const pageTargets = okayTargets.slice(
          currentPage * 10,
          (currentPage + 1) * 10,
        );

        const targetListText =
          pageTargets.length > 0
            ? pageTargets
                .map((m, index) => {
                  const idx = currentPage * 10 + index + 1;
                  return `${idx}. **${m.name}** [Lvl ${m.level}] · [Attack](https://www.torn.com/page.php?sid=attack&user2ID=${m.id})`;
                })
                .join("\n")
            : "No eligible targets currently.";

        const ffaEmbed = new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle(
            `${contract.title} - Targets Listing (${okayTargets.length} total)`,
          )
          .setDescription(`**Available Targets**:\n${targetListText}`)
          .setFooter({
            text: `Sentinel • Page ${currentPage + 1} of ${totalPages}`,
          })
          .setTimestamp();

        const components: any[] = [];

        if (totalPages > 1) {
          const prevButton = new ButtonBuilder()
            .setCustomId(`merc_page_prev_${contract.id}_${currentPage}`)
            .setLabel("◀ Prev")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0);

          const nextButton = new ButtonBuilder()
            .setCustomId(`merc_page_next_${contract.id}_${currentPage}`)
            .setLabel("Next ▶")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === totalPages - 1);

          components.push(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              prevButton,
              nextButton,
            ),
          );
        }

        let prewarMsgId: string | null = null;
        if (prewarPop?.message_id) {
          const msg = await channel.messages
            .fetch(prewarPop.message_id)
            .catch(() => null);
          if (msg) {
            await msg.edit({ embeds: [ffaEmbed], components }).catch(() => {});
            prewarMsgId = msg.id;
          }
        }

        if (!prewarMsgId) {
          const newMsg = await channel
            .send({ embeds: [ffaEmbed], components })
            .catch(() => null);
          if (newMsg) {
            const popId = prewarPop?.id || randomUUID();
            await db
              .insertInto(TABLE_NAMES.MERCENARY_POPULATIONS)
              .values({
                id: popId,
                contract_id: contract.id,
                guild_id: guildId,
                population_type: "prewar",
                target_count: okayTargets.length,
                channel_id: config.hit_post_channel_id,
                message_id: newMsg.id,
                posted_at: new Date().toISOString(),
              })
              .onConflict((oc) =>
                oc.column("id").doUpdateSet({
                  target_count: okayTargets.length,
                  message_id: newMsg.id,
                  posted_at: new Date().toISOString(),
                }),
              )
              .execute();
          }
        } else {
          await db
            .updateTable(TABLE_NAMES.MERCENARY_POPULATIONS)
            .set({
              target_count: okayTargets.length,
              posted_at: new Date().toISOString(),
            })
            .where("id", "=", prewarPop!.id)
            .execute();
        }
      } catch (err) {
        logger.error(
          `Failed to track targets for contract ${contract.id}`,
          err,
        );
      }
    }
  } catch (error) {
    logger.error(
      `Error in runMercenaryTrackerGuildSync for guild ${guildId}`,
      error,
    );
  }
}
