import {
  CrimeLedger,
  CrimeLogs,
  Logger,
  SystemState,
  TornCrimes,
  SystemStateDocument,
  getCrimeIdFromAction,
  calculateCrimeLogValue,
  LogRouteMap,
  StrictUserLog,
  PersonalLogs,
} from "@sentinel/shared";
import { workerEvents } from "../../lib/event-bus.js";
import { runSequentialInit } from "../../lib/init-queue.js";
import type { WorkerStartOptions } from "../registry.js";

const logger = new Logger("crimes_module");

type CrimeLogIds =
  | 9010
  | 9015
  | 9020
  | 9025
  | 9027
  | 9030
  | 9050
  | 9051
  | 9052
  | 9053
  | 9055
  | 9056
  | 9060
  | 9065
  | 9070
  | 9071
  | 9072
  | 9073
  | 9150
  | 9154
  | 9155
  | 9158
  | 9160
  | 9163
  | 9165
  | 9190
  | 9191;

// Define routes early so the init function can map the IDs
export const CRIME_LOG_ROUTES: LogRouteMap = {
  9010: [parseCrimes],
  9015: [parseCrimes],
  9020: [parseCrimes],
  9025: [parseCrimes],
  9027: [parseCrimes],
  9030: [parseCrimes],
  9050: [parseCrimes],
  9051: [parseCrimes],
  9052: [parseCrimes],
  9053: [parseCrimes],
  9055: [parseCrimes],
  9056: [parseCrimes],
  9060: [parseCrimes],
  9065: [parseCrimes],
  9070: [parseCrimes],
  9071: [parseCrimes],
  9072: [parseCrimes],
  9073: [parseCrimes],
  9150: [parseCrimes],
  9154: [parseCrimes],
  9155: [parseCrimes],
  9158: [parseCrimes],
  9160: [parseCrimes],
  9163: [parseCrimes],
  9165: [parseCrimes],
  9190: [parseCrimes],
  9191: [parseCrimes],
};

const CRIME_LOG_IDS = Object.keys(CRIME_LOG_ROUTES).map(Number);

async function parseCrimes(log: StrictUserLog<CrimeLogIds>): Promise<void> {
  try {
    const data = log.data;
    if (!data.crime_action) return;

    const crimeId = getCrimeIdFromAction(data.crime_action);
    const base = crimeId !== 0 ? CrimeLedger.findOne(crimeId.toString()) : null;
    if (crimeId !== 0 && !base) return;

    const logValue = calculateCrimeLogValue(data);

    // 1. Store the individual log event
    CrimeLogs.insertOne({
      id: log.id.toString(),
      crime_id: crimeId,
      action: data.crime_action,
      nerve: data.nerve || 0,
      value: logValue,
      timestamp: log.timestamp,
    });

    // 2. Increment the aggregate ledger totals
    if (base) {
      CrimeLedger.update({
        ...base,
        nerve_spent: base.nerve_spent + (data.nerve || 0),
        total_value: base.total_value + logValue,
      });
    }
  } catch (error) {
    logger.error("Error parsing crime log:", error);
  }
}

async function runCrimesLedgerInit() {
  try {
    logger.warn("Initializing Crimes Ledger V2");

    // 1. Wipe broken/legacy data from the previous architecture
    CrimeLedger.deleteManyBy({});
    CrimeLogs.deleteManyBy({});

    // 2. Prepare blank base CrimeLedger records
    const crimes = TornCrimes.findAll();
    const ledgerInserts = crimes.map((crime) => ({
      id: crime.id.toString(),
      crime_name: crime.data.name,
      nerve_spent: 0,
      total_value: 0,
    }));

    // 3. Query the local DB via indexed findIn, filter for crime IDs, and sort chronologically
    const crimeLogs = PersonalLogs.findIn(
      "details.id",
      CRIME_LOG_IDS,
    ).sort((a, b) => a.timestamp - b.timestamp);

    logger.warn(`Found ${crimeLogs.length} historical crime logs. Parsing...`);

    // 4. Replay through in-memory aggregator map
    const crimeLogsToInsert = [];
    const totalsMap = new Map<number, { nerve: number; value: number }>();

    let parsed = 0;
    for (const log of crimeLogs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = log.data as any;
      if (!data || !data.crime_action) continue;

      const crimeId = getCrimeIdFromAction(data.crime_action);
      const logValue = calculateCrimeLogValue(data);
      const nerveSpent = data.nerve || 0;

      crimeLogsToInsert.push({
        id: log.id.toString(),
        crime_id: crimeId,
        action: data.crime_action,
        nerve: nerveSpent,
        value: logValue,
        timestamp: log.timestamp,
      });

      if (crimeId !== 0) {
        const current = totalsMap.get(crimeId) || { nerve: 0, value: 0 };
        current.nerve += nerveSpent;
        current.value += logValue;
        totalsMap.set(crimeId, current);
      }

      parsed++;
    }

    if (crimeLogsToInsert.length > 0) {
      CrimeLogs.insertMany(crimeLogsToInsert);
    }

    const updatedLedger = ledgerInserts.map((base) => {
      const crimeId = Number(base.id);
      const totals = totalsMap.get(crimeId);
      if (!totals) return base;
      return {
        ...base,
        nerve_spent: totals.nerve,
        total_value: totals.value,
      };
    });

    if (updatedLedger.length > 0) {
      CrimeLedger.insertMany(updatedLedger);
    }

    // 5. Save the new V2 state
    SystemState.update({
      id: "crimes_ledger_v2_init",
      init: true,
      timestamp: Math.floor(Date.now() / 1000),
    });

    logger.info(
      `Crimes Ledger initialized successfully. Parsed ${parsed} logs.`,
    );
  } catch (error) {
    logger.error("Failed to initialize Crimes Ledger:", error);
  }
}

function checkAndInit() {
  // 1. Check if the master engine has completed historical log backfill
  const backfillState = SystemState.findOne("log_manager_backfill_progress") as
    | Extract<SystemStateDocument, { id: "log_manager_backfill_progress" }>
    | undefined;

  if (!backfillState || backfillState.status !== "completed") {
    logger.warn(
      "Log backfill is ongoing or incomplete. Postponing Crimes module initialization.",
    );
    return;
  }

  // 2. Check if this specific module has completed its V2 initialization
  const initState = SystemState.findOne("crimes_ledger_v2_init");
  if (!initState) {
    runSequentialInit("crimes_init", runCrimesLedgerInit);
  }
}

export function startCrimesModule(_options?: WorkerStartOptions): void {
  // Attempt to boot immediately
  checkAndInit();

  // Listen for the master engine to broadcast completion, then attempt boot again
  workerEvents.on("log_backfill_completed", () => {
    checkAndInit();
  });
}
