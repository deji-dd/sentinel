import { Logger } from "@sentinel/utils";
import { startTerritoryBlueprintSync } from "./public/territory-blueprints.js";
import { startTerritoryActivitySync } from "./public/territory-activity.js";
import { startTornReferenceSync } from "./public/torn-reference-sync.js";
import { startTravelSync } from "./public/travel-sync.js";
import { startFactionSync } from "./public/faction-sync.js";
import { startVerificationWorker } from "./public/verification-worker.js";
import { startLogManager } from "./private/log-manager.js";
import { startGymModule } from "./private/gym.js";
import { startCrimesModule } from "./private/crimes.js";
import { startPersonalReferenceSync } from "./private/personal-reference-sync.js";
import { startLiveStateSync } from "./private/personal-state-sync.js";
import { startCompanyModule } from "./private/company.js";
import { startStocksModule } from "./private/stocks.js";
import { startTravelModule } from "./private/travel.js";
import { startWealthModule } from "./private/wealth.js";
import { startSequentialInitsManager } from "./private/sequential-inits.js";
import { startSystemMaintenance } from "./system/system-maintenance.js";
import { startPondSimulationWorker } from "./system/pond-simulation.js";

const logger = new Logger("WorkerRegistry");

export type WorkerStartOptions = {
  initialDelayMs?: number;
};

export type WorkerStarter = (options?: WorkerStartOptions) => void;

/**
 * Worker category registry lists.
 * Modules register their entry functions here.
 */
const SYSTEM_WORKERS: WorkerStarter[] = [
  startSystemMaintenance,
  startPondSimulationWorker,
];
const PRIVATE_WORKERS: WorkerStarter[] = [
  startLogManager,
  startSequentialInitsManager,
  startGymModule,
  startCrimesModule,
  startPersonalReferenceSync,
  startLiveStateSync,
  startCompanyModule,
  startStocksModule,
  startTravelModule,
  startWealthModule,
];
const PUBLIC_WORKERS: WorkerStarter[] = [
  startTerritoryBlueprintSync,
  startTerritoryActivitySync,
  startTornReferenceSync,
  startTravelSync,
  startFactionSync,
  startVerificationWorker,
];

/**
 * Register worker starters into system categories.
 */
export function registerSystemWorker(starter: WorkerStarter): void {
  SYSTEM_WORKERS.push(starter);
}

export function registerPrivateWorker(starter: WorkerStarter): void {
  PRIVATE_WORKERS.push(starter);
}

export function registerPublicWorker(starter: WorkerStarter): void {
  PUBLIC_WORKERS.push(starter);
}

/**
 * Starts all registered background workers with a staggered boot delay
 * to prevent initial CPU and memory spikes.
 */
export function startRegisteredWorkers(options?: {
  staggerMs?: number;
}): number {
  const envStagger = process.env.WORKER_STAGGER_MS
    ? parseInt(process.env.WORKER_STAGGER_MS, 10)
    : NaN;
  const staggerMs =
    options?.staggerMs ?? (isNaN(envStagger) ? 2500 : envStagger);

  const ALL_WORKERS = [
    ...SYSTEM_WORKERS,
    ...PRIVATE_WORKERS,
    ...PUBLIC_WORKERS,
  ];

  if (ALL_WORKERS.length === 0) {
    logger.info(
      "No background workers currently registered in worker registry.",
    );
    return 0;
  }

  logger.info(
    `Starting ${ALL_WORKERS.length} workers with ${staggerMs}ms stagger delay...`,
  );

  let started = 0;
  for (const start of ALL_WORKERS) {
    const initialDelayMs = started * staggerMs;
    start({ initialDelayMs });
    started++;
  }

  return started;
}
