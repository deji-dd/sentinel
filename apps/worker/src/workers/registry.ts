import {
  startUserDataWorker,
  startTornGymsWorker,
  startUserSnapshotWorker,
  startUserSnapshotPruningWorker,
  startTrainingRecommendationsWorker,
  startBattlestatsSyncWorker,
  startBattlestatsPruningWorker,
} from "./private/index.js";
import {
  startTornItemsWorker,
  startFactionSyncWorker,
  startTerritoryBlueprintSyncWorker,
  startWarLedgerSyncWorker,
  startTerritoryStateSyncWorker,
  startRateLimitPruningWorker,
  startWarLedgerPruningWorker,
  startWorkerLogsPruningWorker,
} from "./public/index.js";

export type WorkerScope = "private" | "public" | "all";

type Starter = () => void;

const PRIVATE_WORKERS: Starter[] = [
  startTornGymsWorker,
  startUserDataWorker,
  startUserSnapshotWorker,
  startUserSnapshotPruningWorker,
  startTrainingRecommendationsWorker,
  startBattlestatsSyncWorker,
  startBattlestatsPruningWorker,
];

const PUBLIC_WORKERS: Starter[] = [
  startTornItemsWorker,
  startFactionSyncWorker,
  startTerritoryBlueprintSyncWorker,
  startWarLedgerSyncWorker,
  startTerritoryStateSyncWorker,
  startRateLimitPruningWorker,
  startWarLedgerPruningWorker,
  startWorkerLogsPruningWorker,
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
