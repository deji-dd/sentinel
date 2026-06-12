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
  const normalized = workerName.toLowerCase().replace(/_/g, "-");
  
  if (normalized.includes("pruning") || normalized.includes("cleanup")) {
    return COLORS.DIM;
  }
  if (normalized.includes("sync")) {
    if (normalized.includes("faction")) return COLORS.BLUE;
    if (normalized.includes("state")) return COLORS.MAGENTA;
    if (normalized.includes("blueprint")) return COLORS.GREEN;
    if (normalized.includes("ledger")) return COLORS.YELLOW;
    return COLORS.CYAN;
  }
  if (normalized.includes("torn")) {
    if (normalized.includes("gyms")) return COLORS.BLUE;
    if (normalized.includes("items")) return COLORS.CYAN;
  }
  if (normalized.includes("mercenary")) {
    return COLORS.YELLOW;
  }
  if (normalized.includes("dispatcher") || normalized.includes("cron")) {
    return COLORS.YELLOW;
  }
  if (normalized.includes("recommendations")) {
    return COLORS.BLUE;
  }
  
  return WORKER_COLORS[workerName] || COLORS.CYAN;
}

function colorize(text: string, color: string): string {
  return `${color}${text}${COLORS.RESET}`;
}

export function logSection(message: string): void {
  console.log(`\n${colorize(message, COLORS.BRIGHT)}\n`);
}

export class Logger {
  private name: string;
  private color: string;

  constructor(name: string) {
    this.name = name;
    this.color = getWorkerColor(name);
  }

  private getTimestamp(): string {
    return new Date().toLocaleTimeString("en-US", { hour12: false });
  }

  private formatDuration(durationMs?: number): string {
    if (durationMs === undefined) return "";
    const durationText =
      durationMs < 1000
        ? `${durationMs}ms`
        : `${(durationMs / 1000).toFixed(2)}s`;
    return ` (${durationText})`;
  }

  private formatMessage(level: string, message: string, durationMs?: number): string {
    const timestamp = colorize(this.getTimestamp(), COLORS.DIM);
    const prefix = colorize(`[${this.name}]`, this.color);
    const duration = this.formatDuration(durationMs);
    
    // Format: [name] timestamp (time taken): message
    if (duration) {
      return `${prefix} ${timestamp}${colorize(duration, COLORS.DIM)}: ${message}`;
    }
    return `${prefix} ${timestamp}: ${message}`;
  }

  info(message: string, durationMs?: number): void {
    console.log(this.formatMessage("info", message, durationMs));
  }

  success(message: string, durationMs?: number): void {
    console.log(this.formatMessage("success", colorize(message, COLORS.GREEN), durationMs));
  }

  warn(message: string, durationMs?: number): void {
    console.warn(this.formatMessage("warn", colorize(message, COLORS.YELLOW), durationMs));
  }

  error(message: string, error?: unknown, durationMs?: number): void {
    let detailedMessage = message;
    if (error !== undefined) {
      if (error instanceof Error) {
        detailedMessage += ` - Error: ${error.message}`;
        if (error.stack) {
          detailedMessage += `\n${error.stack}`;
        }
      } else {
        detailedMessage += ` - Error: ${String(error)}`;
      }
    }
    console.error(this.formatMessage("error", colorize(detailedMessage, COLORS.RED), durationMs));
  }

  debug(message: string, durationMs?: number): void {
    console.log(this.formatMessage("debug", colorize(message, COLORS.MAGENTA), durationMs));
  }
}
