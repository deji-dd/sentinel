import { Logger } from "@sentinel/utils";

const logger = new Logger("InitQueue");

let queuePromise: Promise<void> = Promise.resolve();

/**
 * Ensures that heavy startup tasks (e.g. historical log backfills, reference data preloading)
 * execute sequentially in a single-threaded queue rather than simultaneously,
 * preventing memory spikes and PM2 restarts.
 *
 * @param name Description of the initialization task
 * @param fn Async task execution function
 */
export function runSequentialInit(
  name: string,
  fn: () => Promise<void> | void,
): Promise<void> {
  const nextTask = queuePromise.then(async () => {
    logger.info(`Starting sequential initialization: ${name}`);
    const start = performance.now();
    try {
      await fn();
      const elapsedSec = ((performance.now() - start) / 1000).toFixed(2);
      logger.info(`Completed sequential initialization: ${name} in ${elapsedSec}s`);
    } catch (err) {
      logger.error(`Sequential initialization failed for ${name}:`, err);
    }
  });

  // Keep queue alive even if an individual task fails
  queuePromise = nextTask.catch(() => {});
  return nextTask;
}
