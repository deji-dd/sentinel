import { Logger } from "@sentinel/shared";
import * as privateWorkers from "./private/index.js";
import * as publicWorkers from "./public/index.js";
import * as systemWorkers from "./system/index.js";

const logger = new Logger("worker_registry");

export type WorkerStartOptions = {
  initialDelayMs?: number;
};

type Starter = (options?: WorkerStartOptions) => void;

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

export function startWorkers(options?: { staggerMs?: number }): number {
  const envStagger = process.env.WORKER_STAGGER_MS
    ? parseInt(process.env.WORKER_STAGGER_MS, 10)
    : NaN;
  const staggerMs =
    options?.staggerMs ?? (isNaN(envStagger) ? 2500 : envStagger);

  let started = 0;
  const ALL_WORKERS = [
    ...SYSTEM_WORKERS,
    ...PRIVATE_WORKERS,
    ...PUBLIC_WORKERS,
  ];

  logger.info(
    `Starting ${ALL_WORKERS.length} workers with ${staggerMs}ms stagger delay...`,
  );

  for (const start of ALL_WORKERS) {
    const initialDelayMs = started * staggerMs;
    start({ initialDelayMs });
    started += 1;
  }

  return started;
}
