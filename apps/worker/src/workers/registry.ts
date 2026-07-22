import * as privateWorkers from "./private/index.js";
import * as publicWorkers from "./public/index.js";
import * as systemWorkers from "./system/index.js";

type Starter = () => void;

const PRIVATE_WORKERS: Starter[] = [
  privateWorkers.startLogManager,
  privateWorkers.startCrimesModule,
  privateWorkers.startGymModule,
  privateWorkers.startStocksModule,
  privateWorkers.startDailySync,
  privateWorkers.startLiveStateSync,
  privateWorkers.registerCompanyAlarmClock,
  privateWorkers.startWealthModule,
];

const PUBLIC_WORKERS: Starter[] = [
  publicWorkers.startTerritoryBlueprintSync,
  publicWorkers.startTerritoryActivitySync,
  publicWorkers.startFactionSync,
  publicWorkers.startTornReferenceSync,
  publicWorkers.startTravelSync,
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

  return started;
}
