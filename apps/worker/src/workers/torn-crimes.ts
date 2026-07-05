/* eslint-disable @typescript-eslint/no-explicit-any, no-empty */
import { executeSync } from "../lib/sync.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { Logger } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

const WORKER_NAME = "torn_crimes_worker";
const crimesLogger = new Logger(WORKER_NAME);

function getCrimeIdFromAction(action: string): number {
  const lower = action.toLowerCase().trim();
  if (lower.includes("search") || lower.includes("trash") || lower.includes("subway") || lower.includes("junkyard") || lower.includes("beach") || lower.includes("cemetery") || lower.includes("fountain")) {
    return 1;
  }
  if (lower.includes("dvd") || lower.includes("bootleg") || lower.includes("online store")) {
    return 2;
  }
  if (lower.includes("graffiti")) {
    return 3;
  }
  if (lower.includes("shoplift")) {
    return 4;
  }
  if (lower.includes("pickpocket")) {
    return 5;
  }
  if (lower.includes("skim") || lower.includes("skimming") || lower.includes("atm")) {
    return 6;
  }
  if (lower.includes("casing") || lower.includes("burgle") || lower.includes("burgling") || lower.includes("scouting") || lower.includes("burglary") || lower.includes("brewery") || lower.includes("truckyard") || lower.includes("foundry")) {
    return 7;
  }
  if (lower.includes("hustle") || lower.includes("hustling") || lower.includes("shell game") || lower.includes("street hustle")) {
    return 8;
  }
  if (lower.includes("dispose") || lower.includes("disposal") || lower.includes("body") || lower.includes("discard")) {
    return 9;
  }
  if (lower.includes("crack") || lower.includes("cracking") || lower.includes("safe") || lower.includes("vault")) {
    return 10;
  }
  if (lower.includes("forge") || lower.includes("forgery") || lower.includes("project") || lower.includes("step #")) {
    return 11;
  }
  if (lower.includes("scam") || lower.includes("spam")) {
    return 12;
  }
  if (lower.includes("rob") || lower.includes("robbery") || lower.includes("inquire") || lower.includes("make entry") || lower.includes("plant evidence") || lower.includes("place combustible") || lower.includes("ignite fire") || lower.includes("stoke fire") || lower.includes("dampen fire") || lower.includes("collect")) {
    return 13;
  }
  return 0;
}

export async function syncCrimesData(): Promise<void> {
  const db = getKysely();

  // Wait for central_log_manager backfill to complete first
  const scheduleRow = await db
    .selectFrom("sentinel_worker_schedules as s")
    .innerJoin("sentinel_workers as w", "s.worker_id", "w.id")
    .select("s.metadata")
    .where("w.name", "=", "central_log_manager")
    .executeTakeFirst();

  let isBackfilling = true;
  if (scheduleRow?.metadata) {
    try {
      const parsed = JSON.parse(scheduleRow.metadata);
      if (parsed.backfill_complete) {
        isBackfilling = false;
      }
    } catch {}
  }

  if (isBackfilling) {
    crimesLogger.info("Central Log Manager backfill in progress. Deferring run...");
    return;
  }

  const apiKey = await getSystemApiKey("personal");

  // Load scheduler metadata to fetch last run timestamp
  const schedule = await db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES as any)
    .select(["metadata", "last_run_at"])
    .where("worker_id", "=", (qb: any) =>
      qb.selectFrom(TABLE_NAMES.WORKERS as any).select("id").where("name", "=", WORKER_NAME)
    )
    .executeTakeFirst();

  let lastRunTimestamp = 0;
  if (schedule?.last_run_at) {
    lastRunTimestamp = Math.floor(new Date(schedule.last_run_at).getTime() / 1000);
  }

  // Check if we have any crimes at all in sentinel_user_crimes
  const existingCountRow = await db
    .selectFrom("sentinel_user_crimes")
    .select((eb: any) => eb.fn.count("crime_id").as("count"))
    .executeTakeFirst();
  const hasExistingCrimes = Number((existingCountRow as any)?.count || 0) > 0;

  // 1. Scan all historical logs in the DB to find attempted crime IDs
  const allLogs = await db
    .selectFrom(TABLE_NAMES.USER_LOGS as any)
    .select(["data"])
    .where((eb: any) =>
      eb.or([
        eb("category", "=", "Crimes"),
        eb("category", "like", "%crime%"),
        eb("title", "like", "%crime%")
      ])
    )
    .execute();

  const loggedCrimeIds = new Set<number>();
  for (const log of allLogs) {
    try {
      const data = typeof log.data === "string" ? JSON.parse(log.data) : log.data || {};
      let crimeId = Number(data.crime || data.crime_id || 0);
      if (crimeId === 0 && data.crime_action) {
        crimeId = getCrimeIdFromAction(data.crime_action);
      }
      if (crimeId > 0) {
        loggedCrimeIds.add(crimeId);
      }
    } catch {}
  }

  // Find crime IDs we already have records for
  const existingCrimes = await db
    .selectFrom("sentinel_user_crimes")
    .select("crime_id")
    .execute();
  const existingCrimeIds = new Set(existingCrimes.map((c: any) => Number(c.crime_id)));

  // Crime IDs that are missing from sentinel_user_crimes
  const missingCrimeIds = [...loggedCrimeIds].filter(id => !existingCrimeIds.has(id));
  const activeCrimeIds = new Set<number>(missingCrimeIds);

  // 2. Also check for new logs since the last run for existing crime IDs
  const newLogs = await db
    .selectFrom(TABLE_NAMES.USER_LOGS as any)
    .select(["data"])
    .where((eb: any) =>
      eb.or([
        eb("category", "=", "Crimes"),
        eb("category", "like", "%crime%"),
        eb("title", "like", "%crime%")
      ])
    )
    .where("timestamp", ">", lastRunTimestamp)
    .execute();

  for (const log of newLogs) {
    try {
      const data = typeof log.data === "string" ? JSON.parse(log.data) : log.data || {};
      let crimeId = Number(data.crime || data.crime_id || 0);
      if (crimeId === 0 && data.crime_action) {
        crimeId = getCrimeIdFromAction(data.crime_action);
      }
      if (crimeId > 0) {
        activeCrimeIds.add(crimeId);
      }
    } catch {}
  }

  // If no new crime activity and no missing backfilled crimes, skip API calls entirely!
  if (activeCrimeIds.size === 0 && hasExistingCrimes) {
    crimesLogger.info("No new crime activity in raw logs. Skipping sync.");
    return;
  }

  crimesLogger.info("Starting Torn Crimes sync...");

  // 2. Fetch all static release crimes
  const crimesResponse = (await tornApi.get("/torn/crimes", { apiKey })) as any;
  const crimesList = crimesResponse.crimes || [];

  if (!Array.isArray(crimesList) || crimesList.length === 0) {
    crimesLogger.warn("No crimes returned from /torn/crimes");
    return;
  }

  crimesLogger.info(`Found ${crimesList.length} crimes in Torn. Syncing details...`);

  // Resolve user_id
  let userId = Number(process.env.SENTINEL_USER_ID);
  if (!userId) {
    const ownerDiscordId = process.env.SENTINEL_DISCORD_USER_ID;
    if (ownerDiscordId) {
      const personalSettings = await db
        .selectFrom("sentinel_personal_settings" as any)
        .select("user_id")
        .where("discord_id", "=", ownerDiscordId)
        .executeTakeFirst();
      if (personalSettings?.user_id) {
        userId = Number(personalSettings.user_id);
      }
    }
  }

  if (!userId || isNaN(userId)) {
    throw new Error("Could not resolve Torn user ID for sync");
  }

  // Sync static details and conditional user stats
  for (const crime of crimesList) {
    const crimeId = Number(crime.id);
    if (!crimeId || isNaN(crimeId)) continue;

    // Always update static crime metadata
    await db
      .insertInto(TABLE_NAMES.TORN_CRIMES as any)
      .values({
        id: crimeId,
        name: crime.name,
        category_id: crime.category_id,
        category_name: crime.category_name,
        enhancer_id: crime.enhancer_id,
        enhancer_name: crime.enhancer_name,
        unique_outcomes_count: crime.unique_outcomes_count,
        unique_outcomes_ids: JSON.stringify(crime.unique_outcomes_ids || []),
        notes: JSON.stringify(crime.notes || []),
        updated_at: new Date().toISOString(),
      })
      .onConflict((oc: any) =>
        oc.column("id").doUpdateSet({
          name: crime.name,
          category_id: crime.category_id,
          category_name: crime.category_name,
          enhancer_id: crime.enhancer_id,
          enhancer_name: crime.enhancer_name,
          unique_outcomes_count: crime.unique_outcomes_count,
          unique_outcomes_ids: JSON.stringify(crime.unique_outcomes_ids || []),
          notes: JSON.stringify(crime.notes || []),
          updated_at: new Date().toISOString(),
        })
      )
      .execute();

    // Only fetch user details if this is first run or the user committed this crime recently
    if (!hasExistingCrimes || activeCrimeIds.has(crimeId)) {
      // Sync subcrimes definitions
      try {
        const subcrimesResponse = (await tornApi.get("/torn/{crimeId}/subcrimes", {
          apiKey,
          pathParams: { crimeId } as any,
        })) as any;

        const subcrimesList = subcrimesResponse.subcrimes || [];
        if (Array.isArray(subcrimesList)) {
          for (const sub of subcrimesList) {
            const subId = Number(sub.id);
            if (!subId || isNaN(subId)) continue;
            await db
              .insertInto(TABLE_NAMES.TORN_SUBCRIMES as any)
              .values({
                subcrime_id: subId,
                crime_id: crimeId,
                name: sub.name || "Unknown",
                nerve_cost: Number(sub.nerve_cost || 0),
                updated_at: new Date().toISOString(),
              })
              .onConflict((oc: any) =>
                oc.column("subcrime_id").doUpdateSet({
                  name: sub.name || "Unknown",
                  nerve_cost: Number(sub.nerve_cost || 0),
                  updated_at: new Date().toISOString(),
                })
              )
              .execute();
          }
        }
      } catch (err) {
        crimesLogger.error(`Failed to sync subcrimes definitions for crime ID ${crimeId}`, err);
      }

      // Fetch user specific cumulative stats
      try {
        crimesLogger.info(`Fetching user stats for active crime ID ${crimeId} (${crime.name})...`);
        const userCrimeResponse = (await tornApi.get("/user/{crimeId}/crimes", {
          apiKey,
          pathParams: { crimeId },
        })) as any;

        const userCrime = userCrimeResponse.crimes;
        if (userCrime) {
          const attempts = userCrime.attempts || {};
          const rewards = userCrime.rewards || {};
          const ammo = rewards.ammo || {};
          const items = rewards.items || [];
          const uniques = userCrime.uniques || [];
          const subcrimes = attempts.subcrimes || [];

          await db
            .insertInto(TABLE_NAMES.USER_CRIMES as any)
            .values({
              user_id: userId,
              crime_id: crimeId,
              nerve_spent: Number(userCrime.nerve_spent || 0),
              skill: Number(userCrime.skill || 0),
              progression_bonus: Number(userCrime.progression_bonus || 0),
              attempts_total: Number(attempts.total || 0),
              attempts_success: Number(attempts.success || 0),
              attempts_fail: Number(attempts.fail || 0),
              attempts_critical_fail: Number(attempts.critical_fail || 0),
              attempts_subcrimes: JSON.stringify(subcrimes),
              rewards_money: Number(rewards.money || 0),
              rewards_ammo_standard: Number(ammo.standard || 0),
              rewards_ammo_special: Number(ammo.special || 0),
              rewards_items: JSON.stringify(items),
              uniques: JSON.stringify(uniques),
              miscellaneous: JSON.stringify(userCrime.miscellaneous || {}),
              updated_at: new Date().toISOString(),
            })
            .onConflict((oc: any) =>
              oc.columns(["user_id", "crime_id"]).doUpdateSet({
                nerve_spent: Number(userCrime.nerve_spent || 0),
                skill: Number(userCrime.skill || 0),
                progression_bonus: Number(userCrime.progression_bonus || 0),
                attempts_total: Number(attempts.total || 0),
                attempts_success: Number(attempts.success || 0),
                attempts_fail: Number(attempts.fail || 0),
                attempts_critical_fail: Number(attempts.critical_fail || 0),
                attempts_subcrimes: JSON.stringify(subcrimes),
                rewards_money: Number(rewards.money || 0),
                rewards_ammo_standard: Number(ammo.standard || 0),
                rewards_ammo_special: Number(ammo.special || 0),
                rewards_items: JSON.stringify(items),
                uniques: JSON.stringify(uniques),
                miscellaneous: JSON.stringify(userCrime.miscellaneous || {}),
                updated_at: new Date().toISOString(),
              })
            )
            .execute();
        }
      } catch (err) {
        crimesLogger.error(`Failed to sync user stats for crime ID ${crimeId}`, err);
      }

      // Small throttle delay
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  crimesLogger.success("Torn Crimes sync completed successfully.");
}

export function startTornCrimesWorker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 60, // Poll every minute locally
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 120000,
        handler: syncCrimesData,
      });
    },
  });
}
