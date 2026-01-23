/**
 * Centralized sync framework for background jobs.
 * Handles lock mechanism to prevent overlapping syncs.
 */

import { log, logError, logWarn, logSuccess } from "./logger.js";

interface SyncState {
  isRunning: boolean;
  startTime: number | null;
}

interface SyncConfig {
  name: string;
  timeout: number; // max duration in milliseconds
  handler: () => Promise<void>;
}

const syncStates = new Map<string, SyncState>();

/**
 * Execute a sync job with lock mechanism.
 * Returns false if a sync is already running (prevents overlap).
 */
export async function executeSync(config: SyncConfig): Promise<boolean> {
  const { name, timeout, handler } = config;
  const key = name;

  let state = syncStates.get(key);

  // Initialize state if not exists
  if (!state) {
    state = { isRunning: false, startTime: null };
    syncStates.set(key, state);
  }

  // Check if already running
  if (state.isRunning) {
    const elapsed = Date.now() - (state.startTime || 0);

    // If it's been running longer than timeout, force unlock and log warning
    if (elapsed > timeout) {
      logWarn(
        name,
        `Previous sync exceeded timeout (${elapsed}ms > ${timeout}ms). Force unlocking.`,
      );
      state.isRunning = false;
    } else {
      logWarn(name, `Sync already in progress. Skipping to prevent overlap.`);
      return false;
    }
  }

  // Lock the sync
  state.isRunning = true;
  state.startTime = Date.now();

  try {
    log(name, "Starting sync...");
    await handler();
    const duration = Date.now() - (state.startTime || 0);
    logSuccess(name, `Sync completed in ${duration}ms`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(name, `Sync failed: ${message}`);
    throw error;
  } finally {
    // Unlock
    state.isRunning = false;
    state.startTime = null;
  }
}
