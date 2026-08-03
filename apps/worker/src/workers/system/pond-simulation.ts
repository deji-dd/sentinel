import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "pond_simulation";
const logger = new Logger(WORKER_NAME);
const DEVICE_ID = "pond_01";
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Applies a bounded random walk step to generate realistic metric fluctuations.
 */
function randomWalk(
  current: number,
  min: number,
  max: number,
  maxStep: number,
  decimals = 1,
): number {
  const delta = (Math.random() * 2 - 1) * maxStep;
  const next = Math.max(min, Math.min(max, current + delta));
  return Number(next.toFixed(decimals));
}

export async function executePondSimulation(): Promise<void> {
  const finishSync = logger.time();

  try {
    const lastReading = await db.sensorReading.findFirst({
      where: { deviceId: DEVICE_ID },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();

    // Skip simulation if live telemetry came in within the last 2 minutes
    if (
      lastReading &&
      now.getTime() - lastReading.createdAt.getTime() < STALE_THRESHOLD_MS
    ) {
      finishSync();
      return;
    }

    logger.info(
      `No live telemetry for ${DEVICE_ID} in last 2m. Injecting simulated data point...`,
    );

    // Use previous values as baselines if available, otherwise default to ideal values
    const baseTemp = lastReading ? lastReading.temperatureC : 24.5;
    const basePh = lastReading ? lastReading.ph : 7.2;
    const baseTurb = lastReading ? lastReading.turbidityNtu : 12.0;

    // Smooth random walk bounded within safe operational ranges
    const simulatedTemp = randomWalk(baseTemp, 21.0, 28.5, 0.2, 1);
    const simulatedPh = randomWalk(basePh, 6.8, 7.8, 0.05, 2);
    const simulatedTurb = randomWalk(baseTurb, 5.0, 25.0, 0.5, 1);

    await db.sensorReading.create({
      data: {
        deviceId: DEVICE_ID,
        temperatureC: simulatedTemp,
        ph: simulatedPh,
        turbidityNtu: simulatedTurb,
        pondLevelPct: 100,
        pumpInActive: false,
        pumpDrainActive: false,
        createdAt: now,
      },
    });

    logger.info(
      `Simulated data injected: Temp=${simulatedTemp}°C | pH=${simulatedPh} | Turbidity=${simulatedTurb} NTU`,
    );
    finishSync();
  } catch (error) {
    logger.error("Error executing pond simulation worker:", error);
  }
}

/**
 * Initializes the 60-second automated pond data simulation worker.
 */
export function startPondSimulationWorker(options?: WorkerStartOptions): void {
  const SIXTY_SECONDS = 60;

  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: SIXTY_SECONDS,
    initialDelayMs: options?.initialDelayMs,
    handler: async () => {
      await executePondSimulation();
    },
  });

  logger.info("Pond simulation worker initialized (cadence: 60s).");
}
