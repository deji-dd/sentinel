import { Logger } from "@sentinel/shared";

const logger = new Logger("init_queue");

let queuePromise: Promise<void> = Promise.resolve();

/**
 * Ensures that heavy module initializations (such as historical log parsing routines)
 * run sequentially in a single-threaded queue rather than executing simultaneously,
 * preventing memory spikes that trigger PM2 restarts.
 *
 * @param name Name of the initialization job (for logging)
 * @param fn Async initialization callback function
 */
export function runSequentialInit(
  name: string,
  fn: () => Promise<void> | void,
): Promise<void> {
  const nextTask = queuePromise.then(async () => {
    logger.info(`Starting sequential initialization: ${name}`);
    const time = performance.now();
    try {
      await fn();
      logger.info(
        `Completed sequential initialization: ${name} in ${((performance.now() - time) / 1000).toFixed(2)}s`,
      );
    } catch (err) {
      logger.error(`Failed sequential initialization for ${name}:`, err);
    }
  });

  // Keep the queue chain alive even if a task fails
  queuePromise = nextTask.catch(() => {});
  return nextTask;
}
