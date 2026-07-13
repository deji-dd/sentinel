import { Logger, SystemState, SystemStateDocument } from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import {
  tornApi,
  getWorkerApiKey,
  PersonalLogs,
  LogSyncStates,
  type LogSyncStateDocument,
  type PersonalLogDocument,
  type TornSchema,
} from "@sentinel/shared";
import { workerEvents } from "../../lib/event-bus.js";
import { runCrimesLedgerInit } from "./inits/crimes-ledger.js";
import { parseCrimes } from "./parsers/crimes.js";
import { parseCompanyProfit } from "./parsers/company-profit.js";
import { runItemsLedgerInit } from "./inits/items-ledger.js";
import { parseStandardCash } from "./parsers/standard-cash.js";
import { parseStorageTransfer } from "./parsers/storage-transfer.js";
import { parseZeroCostInjection } from "./parsers/zero-cost.js";
import { parseTransformationSink } from "./parsers/sinks.js";
import { parseBarterTrade } from "./parsers/barter.js";
import { parseFactionLiability } from "./parsers/faction.js";
import { parseEquityProperty } from "./parsers/equities.js";

type InitState = Extract<SystemStateDocument, { init: boolean }>;
type CrimesInitState = Extract<SystemStateDocument, { timestamp: number }>;

const WORKER_NAME = "log_manager";

let isCrimesLedgerInitializing = false;
let isItemsLedgerInitializing = false;

// Polling interval for new logs
const FORWARD_CADENCE_SEC = 60; // 60 seconds
// Polling interval for historical logs (slower to avoid rate limits)
const BACKWARD_CADENCE_SEC = 5; // 5 seconds

function getOrCreateSyncState(): LogSyncStateDocument {
  const stateId = "personal_log_sync_state_singleton";
  let state = LogSyncStates.findOne(stateId);

  if (!state) {
    const now = Math.floor(Date.now() / 1000);
    // Initialize cursors to now per user preference
    state = {
      id: stateId,
      latest_timestamp: now,
      earliest_timestamp: now,
      is_historical_sync_complete: false,
    };
    LogSyncStates.insertOne(state);
  }
  return state;
}

/**
 * Persists each individual API log and emits events
 */
function processFetchedLogs(
  batchResponse: TornSchema<"UserLogsResponse">,
  eventType: "new_log" | null,
): number[] {
  if (!batchResponse.log) {
    return [];
  }

  const timestamps: number[] = [];
  const newDocs: PersonalLogDocument[] = [];

  for (const log of batchResponse.log) {
    // Skip if we already have this log
    if (PersonalLogs.findOne(String(log.id))) continue;

    newDocs.push(log as PersonalLogDocument);
    timestamps.push(log.timestamp);
    if (eventType) workerEvents.emit(eventType, log);
  }

  if (newDocs.length > 0) {
    PersonalLogs.insertMany(newDocs);
  }

  return timestamps;
}

/**
 * Phase A: Forward Fill
 */
async function syncForwards(): Promise<void> {
  const logger = new Logger(WORKER_NAME + "_forward");
  try {
    const state = getOrCreateSyncState();
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    const res = await tornApi.get("/user/log", {
      apiKey,
      queryParams: { from: state.latest_timestamp, limit: 100 },
    });

    if (res.log) {
      const timestamps = processFetchedLogs(res, "new_log");
      if (timestamps.length > 0) {
        const newLatest = Math.max(...timestamps);
        if (newLatest > state.latest_timestamp) {
          state.latest_timestamp = newLatest;
          LogSyncStates.insertOne(state);
        }
      }
    }
  } catch (error) {
    logger.error("Error during forward sync:", error);
  }
}

/**
 * Phase B: Historical Backfill
 */
async function syncBackwards(): Promise<void> {
  const logger = new Logger(WORKER_NAME + "_backward");
  try {
    const state = getOrCreateSyncState();
    if (state.is_historical_sync_complete) return; // Done

    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    const res = await tornApi.get("/user/log", {
      apiKey,
      queryParams: { to: state.earliest_timestamp, limit: 100 },
    });

    if (res.log && res.log.length > 0) {
      const timestamps = processFetchedLogs(res, null);
      if (timestamps.length > 0) {
        const newEarliest = Math.min(...timestamps);
        if (newEarliest < state.earliest_timestamp) {
          state.earliest_timestamp = newEarliest;
          LogSyncStates.insertOne(state);
        }
      }
    } else {
      // If Torn returns empty log array for a `to` query, we've hit the beginning
      state.is_historical_sync_complete = true;
      LogSyncStates.insertOne(state);
      logger.info("Historical sync complete!");
    }
  } catch (error) {
    logger.error("Error during backward sync:", error);
  }
}

export function startLogManager(): void {
  // We use two separate schedules for forward and backward syncing to manage
  // rate limits and interval speeds independently.

  startEventDrivenRunner({
    worker: `${WORKER_NAME}_forward`,
    handler: syncForwards,
    defaultCadenceSeconds: FORWARD_CADENCE_SEC,
  });

  startEventDrivenRunner({
    worker: `${WORKER_NAME}_backward`,
    handler: async () => {
      const state = LogSyncStates.findOne("personal_log_sync_state_singleton");
      if (state?.is_historical_sync_complete) return;
      await syncBackwards();
    },
    defaultCadenceSeconds: BACKWARD_CADENCE_SEC,
  });

  workerEvents.on("new_log", async (log: TornSchema<"UserLog">) => {
    const logger = new Logger(WORKER_NAME);
    logger.info("Processing log: ", log.details.title);
    try {
      let isCrimesInit = false;
      let isItemsInit = false;

      while (!(isCrimesInit && isItemsInit)) {
        isCrimesInit =
          SystemState.find<InitState>({ id: "crimes_init_state" })[0]?.init ||
          false;
        isItemsInit =
          SystemState.find<InitState>({ id: "items_init_state" })[0]?.init ||
          false;

        if (isCrimesInit && isItemsInit) break;

        logger.info("Waiting for crimes and items init states...");

        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      let crimesLedgerInitState = SystemState.find<CrimesInitState>({
        id: "crimes_ledger_init_state",
      })[0];
      let isCrimesLedgerInit = crimesLedgerInitState?.init || false;
      let itemsLedgerInitState = SystemState.find<CrimesInitState>({
        id: "items_ledger_init_state",
      })[0];
      let isItemsLedgerInit = itemsLedgerInitState?.init || false;

      if (!isCrimesLedgerInit && !isCrimesLedgerInitializing) {
        isCrimesLedgerInitializing = true;
        runCrimesLedgerInit().catch(() => {
          isCrimesLedgerInitializing = false;
        });
      }

      while (!isCrimesLedgerInit) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        crimesLedgerInitState = SystemState.find<CrimesInitState>({
          id: "crimes_ledger_init_state",
        })[0];
        isCrimesLedgerInit = crimesLedgerInitState?.init || false;
      }

      if (!isItemsLedgerInit && !isItemsLedgerInitializing) {
        isItemsLedgerInitializing = true;
        runItemsLedgerInit().catch(() => {
          isItemsLedgerInitializing = false;
        });
      }

      while (!isItemsLedgerInit) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        itemsLedgerInitState = SystemState.find<CrimesInitState>({
          id: "items_ledger_init_state",
        })[0];
        isItemsLedgerInit = itemsLedgerInitState?.init || false;
      }

      const logType = log.details.id;
      const logCategory = log.details.category;

      if (logCategory === "Crimes") {
        if (
          crimesLedgerInitState?.timestamp &&
          log.timestamp <= crimesLedgerInitState.timestamp
        ) {
          return;
        }

        parseCrimes(log);
        logger.info("Parsed crime log.");
      }

      if (logType === 6222) {
        await parseCompanyProfit(log);

        logger.info("Parsed company profit.");
      }

      if (log.timestamp > itemsLedgerInitState.timestamp) {
        if (
          [
            1112, 1225, 4200, 4201, 5010, 4320, 1226, 1113, 4210, 4220, 5011,
            4322,
          ].includes(logType) ||
          ["Item market", "Points market", "Shops", "Auctions"].includes(
            logCategory,
          )
        ) {
          parseStandardCash(log);

          logger.info("Parsed standard cash log.");
        } else if (
          [1222, 1302, 1403, 1110, 5000, 4447, 4300, 4700, 4710].includes(
            logType,
          ) ||
          ["Display case", "Equipping"].includes(logCategory)
        ) {
          parseStorageTransfer(log);

          logger.info("Parsed storage transfer log.");
        } else if (
          [
            5725, 7011, 1404, 6733, 7900, 5530, 5531, 1100, 1102, 1105, 1150,
            1200, 4810, 6736, 7033, 7333,
          ].includes(logType) ||
          [
            "Crimes",
            "City finds",
            "Dump",
            "Mission rewards",
            "Crime success",
          ].includes(logCategory)
        ) {
          parseZeroCostInjection(log);

          logger.info("Parsed zero cost injection log.");
        } else if (
          [1104, 1107, 1109, 1111, 1162, 2212, 4800, 5202, 5205].includes(
            logType,
          ) ||
          ["Museum", "Refills", "Church", "Item use"].includes(logCategory)
        ) {
          parseTransformationSink(log);

          logger.info("Parsed transformation sink log.");
        } else if (
          [4430].includes(logType) ||
          ["Trades"].includes(logCategory)
        ) {
          parseBarterTrade(log);

          logger.info("Parsed barter trade log.");
        } else if ([6746, 6747, 6728].includes(logType)) {
          parseFactionLiability(log);

          logger.info("Parsed faction liability log.");
        } else if (
          [6300].includes(logType) ||
          ["Stocks", "Property", "Company"].includes(logCategory)
        ) {
          parseEquityProperty(log);

          logger.info("Parsed equity property log.");
        }
      }
    } catch (error) {
      logger.error("error parsing log: ", error);
    }
  });
}
