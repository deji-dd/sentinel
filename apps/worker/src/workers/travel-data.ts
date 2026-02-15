import { executeSync } from "../lib/sync.js";
// import { getPersonalApiKey } from "../lib/supabase.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";

const WORKER_NAME = "travel_data_worker";

// Personalized bot mode: single user ID from environment
// const PERSONAL_USER_ID: string = (() => {
//   const userId = process.env.SENTINEL_USER_ID;
//   if (!userId) {
//     throw new Error(
//       "SENTINEL_USER_ID environment variable is required for personalized bot mode",
//     );
//   }
//   return userId;
// })();

// function includesAny(text: string, needles: string[]): boolean {
//   const lower = text.toLowerCase();
//   return needles.some((n) => lower.includes(n));
// }

// function extractNumber(text: string): number | null {
//   const match = text.match(/(\d+)/);
//   return match ? Number(match[1]) : null;
// }

// function computeCapacityFromPerks(params: {
//   hasAirstrip: boolean;
//   hasWltBenefit: boolean;
//   enhancerPerks: string[];
//   jobPerks: string[];
//   factionPerks: string[];
//   bookPerks: string[];
// }): number {
//   const {
//     hasAirstrip,
//     hasWltBenefit,
//     enhancerPerks,
//     jobPerks,
//     factionPerks,
//     bookPerks,
//   } = params;

//   let capacity = hasAirstrip || hasWltBenefit ? 15 : 5;

//   let suitcaseBonus = 0;
//   enhancerPerks.forEach((perk) => {
//     const lower = perk.toLowerCase();
//     if (!lower.includes("suitcase")) return;
//     if (lower.includes("large")) {
//       suitcaseBonus = Math.max(suitcaseBonus, 4);
//     } else if (lower.includes("medium")) {
//       suitcaseBonus = Math.max(suitcaseBonus, 3);
//     } else if (lower.includes("small")) {
//       suitcaseBonus = Math.max(suitcaseBonus, 2);
//     } else {
//       const num = extractNumber(lower);
//       if (num) suitcaseBonus = Math.max(suitcaseBonus, num);
//     }
//   });
//   capacity += suitcaseBonus;

//   let jobBonus = 0;
//   jobPerks.forEach((perk) => {
//     const lower = perk.toLowerCase();
//     if (includesAny(lower, ["lingerie"])) {
//       jobBonus = Math.max(jobBonus, 2);
//     }
//     if (includesAny(lower, ["cruise line"])) {
//       if (includesAny(lower, ["10*", "10 star", "10-star"])) {
//         jobBonus = Math.max(jobBonus, 3);
//       } else if (includesAny(lower, ["3*", "3 star", "3-star"])) {
//         jobBonus = Math.max(jobBonus, 2);
//       }
//     }
//     if (includesAny(lower, ["flower shop"]) && includesAny(lower, ["flower"])) {
//       jobBonus = Math.max(jobBonus, 5);
//     }
//     if (includesAny(lower, ["toy shop"]) && includesAny(lower, ["plush"])) {
//       jobBonus = Math.max(jobBonus, 5);
//     }
//   });
//   capacity += jobBonus;

//   let factionBonus = 0;
//   factionPerks.forEach((perk) => {
//     const lower = perk.toLowerCase();
//     if (!includesAny(lower, ["excursion", "travel"])) return;
//     const num = extractNumber(lower);
//     if (num !== null) {
//       factionBonus = Math.max(factionBonus, Math.min(num, 10));
//     }
//   });
//   capacity += factionBonus;

//   const hasSmugglingBook = bookPerks.some((perk) =>
//     includesAny(perk, ["smuggling for beginners", "travel items by 10"]),
//   );
//   if (hasSmugglingBook) {
//     capacity += 10;
//   }

//   capacity = Math.min(capacity, 44);

//   return capacity;
// }

/**
 * Travel data worker - DISABLED during hard pivot to personalized bot
 *
 * This worker is on the backburner. Data is retained in the database
 * for future restoration. The worker is disabled in sentinel_worker_schedules.
 */
async function syncTravelDataHandler(): Promise<void> {
  // DISABLED: Travel module on backburner
  return;
}

/**
 * Start travel data worker with DB-driven scheduling.
 * Default cadence is 30s (configured in DB).
 */
export function startTravelDataWorker(): void {
  startDbScheduledRunner({
    worker: "travel_data_worker",
    defaultCadenceSeconds: 30,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: syncTravelDataHandler,
      });
    },
  });
}
