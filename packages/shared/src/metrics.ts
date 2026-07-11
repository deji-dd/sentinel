import pidusage from "pidusage";
import { SystemState } from "./database/schemas/system-state.js";
import { Logger } from "./utils/logger.js";

const logger = new Logger("metrics_reporter");
let metricsInterval: NodeJS.Timeout | null = null;

export function startMetricsReporter(
  id: "api" | "worker" | "bot",
  intervalMs = 3000,
) {
  if (metricsInterval) {
    clearInterval(metricsInterval);
  }

  logger.info(`Starting System Metrics Reporter for ${id}`);

  // Mark as online immediately
  SystemState.update({
    id,
    cpu: 0,
    memory: 0,
    last_updated: Date.now(),
    status: "online",
  });

  metricsInterval = setInterval(async () => {
    try {
      const stats = await pidusage(process.pid);
      SystemState.update({
        id,
        cpu: Number(stats.cpu.toFixed(1)),
        memory: Number((stats.memory / 1024 / 1024).toFixed(1)), // MB
        last_updated: Date.now(),
        status: "online",
      });
    } catch (err) {
      logger.warn(`Failed to collect metrics for ${id}: ${err}`);
    }
  }, intervalMs);
}

export function stopMetricsReporter(id: "api" | "worker" | "bot") {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
  SystemState.update({
    id,
    cpu: 0,
    memory: 0,
    last_updated: Date.now(),
    status: "offline",
  });
  logger.info(`Stopped System Metrics Reporter for ${id}`);
}
