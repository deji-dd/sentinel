import {
  Logger,
  SystemState,
  getWorkerApiKey,
  GymLedger,
  GymBaseline,
  type StatType,
  SystemStateDocument,
  LogRouteMap,
  StrictUserLog,
  LogDataRegistry,
  PersonalLogs,
  UserState,
  UserStateDocument, // <-- Added for DB querying
} from "@sentinel/shared";
import { workerEvents } from "../../lib/event-bus.js";
import { runSequentialInit } from "../../lib/init-queue.js";
import type { WorkerStartOptions } from "../registry.js";

const logger = new Logger("gym_module");

type GymLogIds =
  | 5300
  | 5301
  | 5302
  | 5303
  | 2120
  | 2130
  | 2140
  | 2150
  | 2052
  | 2053
  | 2054
  | 2055
  | 6526
  | 6527
  | 6528
  | 6529;

// 1. The Internal Helper
function processStatGain(
  log: StrictUserLog<GymLogIds>,
  source: "gym" | "item" | "book" | "company",
) {
  const data = log.data;

  let statType: StatType | null = null;
  let statGained = 0;

  if (data.strength_increased) {
    statType = "strength";
    statGained = data.strength_increased;
  } else if (data.defense_increased) {
    statType = "defense";
    statGained = data.defense_increased;
  } else if (data.speed_increased) {
    statType = "speed";
    statGained = data.speed_increased;
  } else if (data.dexterity_increased) {
    statType = "dexterity";
    statGained = data.dexterity_increased;
  }

  if (!statType) return;

  GymLedger.insertOne({
    id: String(log.id),
    timestamp: log.timestamp,
    stat_type: statType,
    source,
    trains: data.trains ? data.trains : undefined,
    energy_used: data.energy_used ? data.energy_used : undefined,
    stat_gained: statGained,
  });
}

// ------------------------------------------------------------------
// O(1) Router Functions (Strictly Typed)
// ------------------------------------------------------------------

const handleGymTrain = (log: StrictUserLog<5300 | 5301 | 5302 | 5303>) =>
  processStatGain(log, "gym");
const handleStatEnhancer = (log: StrictUserLog<2120 | 2130 | 2140 | 2150>) =>
  processStatGain(log, "item");
const handleBook = (log: StrictUserLog<2052 | 2053 | 2054 | 2055>) =>
  processStatGain(log, "book");
const handleCompanySpecial = (log: StrictUserLog<6526 | 6527 | 6528 | 6529>) =>
  processStatGain(log, "company");

export const GYM_LOG_ROUTES: LogRouteMap = {
  5300: [handleGymTrain],
  5301: [handleGymTrain],
  5302: [handleGymTrain],
  5303: [handleGymTrain],
  2120: [handleStatEnhancer],
  2130: [handleStatEnhancer],
  2140: [handleStatEnhancer],
  2150: [handleStatEnhancer],
  2052: [handleBook],
  2053: [handleBook],
  2054: [handleBook],
  2055: [handleBook],
  6526: [handleCompanySpecial],
  6527: [handleCompanySpecial],
  6528: [handleCompanySpecial],
  6529: [handleCompanySpecial],
};

export const STAT_GAIN_LOG_IDS = Object.keys(GYM_LOG_ROUTES).map(Number);

async function runGymLedgerInit() {
  try {
    logger.warn("Initializing Gym Ledger V2");
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    // 1. Wipe broken/legacy data from the previous architecture
    GymLedger.deleteManyBy({});
    GymBaseline.deleteManyBy({});

    // 2. Establish the Baseline (Local DB Query instead of API Call)
    const currentStats =
      UserState.findOne<Extract<UserStateDocument, { id: "battlestats" }>>(
        "battlestats",
      );

    if (currentStats) {
      GymBaseline.insertOne({
        id: "baseline",
        timestamp: Math.floor(Date.now() / 1000),
        strength: currentStats.strength || 0,
        defense: currentStats.defense || 0,
        speed: currentStats.speed || 0,
        dexterity: currentStats.dexterity || 0,
      });
    } else {
      logger.warn(
        "No battlestats found in UserState. Make sure live-state-sync has run.",
      );
    }

    // 3. Query the local DB via indexed findIn, filter for gym IDs, and sort chronologically
    const gymLogs = PersonalLogs.findIn(
      "details.id",
      STAT_GAIN_LOG_IDS,
    ).sort((a, b) => a.timestamp - b.timestamp);

    logger.warn(`Found ${gymLogs.length} historical gym logs. Parsing...`);

    // 4. Replay through the strict router
    let parsed = 0;
    for (const log of gymLogs) {
      const logId = log.details.id as keyof LogDataRegistry;
      const mappedParsers = GYM_LOG_ROUTES[logId];
      if (mappedParsers) {
        // @ts-ignore - Safely crossing the strict type boundary during bulk dispatch
        mappedParsers.forEach((parse) => parse(log));
        parsed++;
      }
    }

    // 5. Save the new V2 state
    SystemState.update({
      id: "gym_ledger_v2_init",
      init: true,
      timestamp: Math.floor(Date.now() / 1000),
    });

    logger.info(`Gym Ledger initialized successfully. Parsed ${parsed} logs.`);
  } catch (error) {
    logger.error("Failed to initialize Gym Ledger:", error);
  }
}

function checkAndInit() {
  const backfillState = SystemState.findOne("log_manager_backfill_progress") as
    | Extract<SystemStateDocument, { id: "log_manager_backfill_progress" }>
    | undefined;

  if (!backfillState || backfillState.status !== "completed") {
    logger.warn(
      "Log backfill is ongoing or incomplete. Postponing Gym module initialization.",
    );
    return;
  }

  const initState = SystemState.findOne("gym_ledger_v2_init");
  if (!initState) {
    runSequentialInit("gym_init", runGymLedgerInit);
  }
}

export function startGymModule(_options?: WorkerStartOptions): void {
  checkAndInit();

  workerEvents.on("log_backfill_completed", () => {
    checkAndInit();
  });
}
