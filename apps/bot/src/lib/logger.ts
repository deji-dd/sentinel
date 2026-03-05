/**
 * Bot logging utilities
 */

/**
 * Log a message with duration in milliseconds
 */
export function logDuration(task: string, message: string, ms: number): void {
  const duration = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
  console.log(`[${task}] ${message} (${duration})`);
}

/**
 * Log an error message
 */
export function logError(task: string, message: string): void {
  console.error(`[${task}] ERROR: ${message}`);
}

/**
 * Log an info message
 */
export function logInfo(task: string, message: string): void {
  console.log(`[${task}] ${message}`);
}
