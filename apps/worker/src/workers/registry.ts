import {
  startBotCronDispatcherWorker,
  startCentralLogManager,
  startStateTicker,
  startSystemOrchestrator,
  startTornGymsWorker,
  startTornFinanceLogsWorker,
  startTornCrimesWorker,
} from "./private/index.js";
import {
  startTornItemsWorker,
  startFactionSyncWorker,
  startTerritoryBlueprintSyncWorker,
  startWarLedgerSyncWorker,
  startTerritoryStateSyncWorker,
  startMercenaryPopulationWorker,
} from "./public/index.js";

export type WorkerScope = "private" | "public" | "all";

type Starter = () => void;

const PRIVATE_WORKERS: Starter[] = [
  startBotCronDispatcherWorker,
  startCentralLogManager,
  startStateTicker,
  startSystemOrchestrator,
  startTornGymsWorker,
  startTornFinanceLogsWorker,
  startTornCrimesWorker,
];

const PUBLIC_WORKERS: Starter[] = [
  startTornItemsWorker,
  startFactionSyncWorker,
  startTerritoryBlueprintSyncWorker,
  startWarLedgerSyncWorker,
  startTerritoryStateSyncWorker,
  startMercenaryPopulationWorker,
];

export function startWorkersForScope(scope: WorkerScope): number {
  let started = 0;

  if (scope !== "public") {
    for (const start of PRIVATE_WORKERS) {
      start();
      started += 1;
    }
  }

  if (scope !== "private") {
    for (const start of PUBLIC_WORKERS) {
      start();
      started += 1;
    }
  }

  return started;
}
