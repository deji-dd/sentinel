import { Logger, SystemState, SystemStateDocument } from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import {
  tornApi,
  getWorkerApiKey,
  TornCrimes,
  type TornCrimeDocument,
} from "@sentinel/shared";

const WORKER_NAME = "crimes_sync";
const logger = new Logger(WORKER_NAME);

type InitState = Extract<SystemStateDocument, { init: boolean }>;

// Sync daily at 00:00 UTC, equivalent to 86400 seconds
const SYNC_CADENCE_SEC = 86400;

async function syncCrimesReference(): Promise<void> {
  const finishSync = logger.time();
  try {
    const isCrimesInit = SystemState.find<InitState>({
      id: "crimes_init_state",
    })[0]?.init;

    if (!isCrimesInit) {
      logger.info("Crimes not initialized. Clearing table...");
      TornCrimes.deleteManyBy({});
    }

    const apiKey = getWorkerApiKey("system");
    if (!apiKey) throw new Error("No public API key found");

    const res = await tornApi.get("/torn/crimes", {
      apiKey,
    });

    if (res.crimes) {
      const newDocs: TornCrimeDocument[] = [];
      const updatedDocs: TornCrimeDocument[] = [];

      for (const crime of res.crimes) {
        if (!crime) continue;
        const crimeId = crime.id;

        const existing = TornCrimes.findOne(crimeId.toString());
        if (!existing) {
          newDocs.push({
            id: crimeId.toString(),
            data: crime,
          });
        } else {
          updatedDocs.push({
            id: crimeId.toString(),
            data: crime,
          });
        }
      }

      if (newDocs.length > 0) {
        TornCrimes.insertMany(newDocs);
      }

      if (updatedDocs.length > 0) {
        TornCrimes.insertMany(updatedDocs);
      }

      SystemState.insertOne({
        id: "crimes_init_state",
        init: true,
      });

      finishSync();
    }
  } catch (error) {
    logger.error("Error syncing crime references:", error);
  }
}

export function startCrimeReferenceSync(): void {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    handler: syncCrimesReference,
    defaultCadenceSeconds: SYNC_CADENCE_SEC,
  });
}
