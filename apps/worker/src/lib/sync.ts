/**
 * Centralized sync framework for background jobs.
 * Handles lock mechanism to prevent overlapping syncs.
 */

import { logWarn, logDuration } from "./logger.js";

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
      return false;
    }
  }

  // Lock the sync
  state.isRunning = true;
  state.startTime = Date.now();

  try {
    await handler();
    const duration = Date.now() - (state.startTime || 0);
    logDuration(name, "Sync completed", duration);
    return true;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_error) {
    // Handler threw an error - it already logged the details
    // Just unlock and return false to indicate failure
    return false;
  } finally {
    // Unlock
    state.isRunning = false;
    state.startTime = null;
  }
}
