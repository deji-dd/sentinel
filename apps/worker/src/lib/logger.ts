/**
 * Logger utility with color support and consistent formatting for different workers
 */

const COLORS = {
  RESET: "\x1b[0m",
  BRIGHT: "\x1b[1m",
  DIM: "\x1b[2m",

  // Colors
  CYAN: "\x1b[36m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  RED: "\x1b[31m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
};

const WORKER_COLORS: Record<string, string> = {
  "sync-users": COLORS.CYAN,
  "track-travel": COLORS.BLUE,
  "sync-abroad-stocks": COLORS.GREEN,
  "sync-market-prices": COLORS.MAGENTA,
  "seed-trade-items": COLORS.YELLOW,
};

function getWorkerColor(workerName: string): string {
  return WORKER_COLORS[workerName] || COLORS.BLUE;
}

function colorize(text: string, color: string): string {
  return `${color}${text}${COLORS.RESET}`;
}

export function log(workerName: string, message: string): void {
  const color = getWorkerColor(workerName);
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  const prefix = colorize(`[${workerName}]`, color);
  console.log(`${prefix} ${colorize(timestamp, COLORS.DIM)} ${message}`);
}

export function logSuccess(workerName: string, message: string): void {
  const color = getWorkerColor(workerName);
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  const prefix = colorize(`[${workerName}]`, color);
  const msgColor = colorize(message, COLORS.GREEN);
  console.log(`${prefix} ${colorize(timestamp, COLORS.DIM)} ${msgColor}`);
}

export function logError(workerName: string, message: string): void {
  const color = getWorkerColor(workerName);
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  const prefix = colorize(`[${workerName}]`, color);
  const msgColor = colorize(message, COLORS.RED);
  console.error(`${prefix} ${colorize(timestamp, COLORS.DIM)} ${msgColor}`);
}

export function logWarn(workerName: string, message: string): void {
  const color = getWorkerColor(workerName);
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  const prefix = colorize(`[${workerName}]`, color);
  const msgColor = colorize(message, COLORS.YELLOW);
  console.warn(`${prefix} ${colorize(timestamp, COLORS.DIM)} ${msgColor}`);
}

export function logSection(message: string): void {
  console.log(`\n${colorize(message, COLORS.BRIGHT)}\n`);
}
