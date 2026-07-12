import * as privateWorkers from "./private/index.js";
import * as publicWorkers from "./public/index.js";
import * as systemWorkers from "./system/index.js";
// import * as botWorkers from "./bot/index.js";

type Starter = () => void;

const PRIVATE_WORKERS: Starter[] = [
  privateWorkers.startLogManager,
  privateWorkers.startCompanySyncWorker,
  privateWorkers.startLedgerWorker,
  privateWorkers.startLiquidCashEngineWorker,
  privateWorkers.startCrimeParser,
];

// TODO: COMMENT IN DEV, UNCOMMENT BEFORE PUSH
const PUBLIC_WORKERS: Starter[] = [
  publicWorkers.startTerritoryBlueprintSync,
  publicWorkers.startTerritoryActivitySync,
  publicWorkers.startFactionSync,
  publicWorkers.startCrimeReferenceSync,
  publicWorkers.startItemSyncWorker,
];

const BOT_WORKERS: Starter[] = [
  // botWorkers.startBazaarSeeder,
  // botWorkers.startBazaarManager,
];

const SYSTEM_WORKERS: Starter[] = [systemWorkers.startSystemMaintenance];

export function startWorkers(): number {
  let started = 0;

  for (const start of SYSTEM_WORKERS) {
    start();
    started += 1;
  }

  for (const start of PRIVATE_WORKERS) {
    start();
    started += 1;
  }

  for (const start of PUBLIC_WORKERS) {
    start();
    started += 1;
  }

  for (const start of BOT_WORKERS) {
    start();
    started += 1;
  }

  return started;
}
