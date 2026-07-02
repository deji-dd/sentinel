/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeSync } from "../lib/sync.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { Logger } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

const WORKER_NAME = "torn_crimes_worker";
const crimesLogger = new Logger(WORKER_NAME);

export async function syncCrimesData(): Promise<void> {
  const apiKey = await getSystemApiKey("personal");
  const db = getKysely();

  crimesLogger.info("Starting Torn Crimes sync...");

  // 1. Fetch all crimes from /torn/crimes
  const crimesResponse = (await tornApi.get("/torn/crimes", { apiKey })) as any;
  const crimesList = crimesResponse.crimes || [];

  if (!Array.isArray(crimesList) || crimesList.length === 0) {
    crimesLogger.warn("No crimes returned from /torn/crimes");
    return;
  }

  crimesLogger.info(`Found ${crimesList.length} released crimes. Syncing details...`);

  // Resolve user_id
  let userId = Number(process.env.SENTINEL_USER_ID);
  if (!userId) {
    // Fallback: fetch personal settings to get user_id
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

  if (!userId) {
    // Final fallback: fetch user profile to get player_id
    const userProfile = (await tornApi.get("/user", {
      apiKey,
      queryParams: { selections: ["basic"] } as any
    })) as any;
    userId = Number(userProfile.player_id);
  }

  if (!userId || isNaN(userId)) {
    throw new Error("Could not resolve Torn user ID for sync");
  }

  // 2. Loop through crimes to update static details and fetch user historical data
  for (const crime of crimesList) {
    const crimeId = Number(crime.id);
    if (!crimeId || isNaN(crimeId)) continue;

    // Upsert static crime info
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

    // Sync subcrimes details
    try {
      crimesLogger.info(`Fetching subcrimes definitions for crime ID ${crimeId}...`);
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

    // 3. Fetch historical user crime data for this specific crime
    try {
      crimesLogger.info(`Fetching user stats for crime ID ${crimeId} (${crime.name})...`);
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

        // Upsert user crime statistics
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

    // Add a tiny delay to be gentle on API limits
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  crimesLogger.success("Torn Crimes sync completed successfully.");
}

export function startTornCrimesWorker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 1800, // Every 30 minutes
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 120000, // 2 minutes
        handler: syncCrimesData,
      });
    },
  });
}
