/**
 * Logger utility with color support and consistent formatting for the Discord bot
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

const BOT_LOG_COLORS: Record<string, string> = {
  "Scheduler": COLORS.YELLOW,
  "HTTP": COLORS.BLUE,
  "Bot": COLORS.CYAN,
  "SQLite": COLORS.GREEN,
  "AUTH": COLORS.MAGENTA,
  "Interaction": COLORS.MAGENTA,
  "Guild Sync": COLORS.GREEN,
};

function getLogColor(name: string): string {
  return BOT_LOG_COLORS[name] || COLORS.CYAN;
}

function colorize(text: string, color: string): string {
  return `${color}${text}${COLORS.RESET}`;
}

export function logSection(message: string): void {
  console.log(`\n${colorize(message, COLORS.BRIGHT)}\n`);
}

function getTimestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function formatLegacyMessage(task: string, message: string, color: string): string {
  const timestamp = colorize(getTimestamp(), COLORS.DIM);
  const prefix = colorize(`[${task}]`, color);
  return `${prefix} ${timestamp}: ${message}`;
}

/**
 * Legacy log utilities for backward compatibility, formatted in the centralized style without duration.
 */
export function logDuration(task: string, message: string, _ms: number): void {
  // Ignore the duration parameter as requested ("no duration")
  console.log(formatLegacyMessage(task, message, getLogColor(task)));
}

export function logError(task: string, message: string): void {
  console.error(formatLegacyMessage(task, colorize(`ERROR: ${message}`, COLORS.RED), COLORS.RED));
}

export function logInfo(task: string, message: string): void {
  console.log(formatLegacyMessage(task, message, getLogColor(task)));
}

export class Logger {
  private name: string;
  private color: string;

  constructor(name: string) {
    this.name = name;
    this.color = getLogColor(name);
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = colorize(getTimestamp(), COLORS.DIM);
    const prefix = colorize(`[${this.name}]`, this.color);
    
    // Format: [name] timestamp: message
    return `${prefix} ${timestamp}: ${message}`;
  }

  info(message: string): void {
    console.log(this.formatMessage("info", message));
  }

  success(message: string): void {
    console.log(this.formatMessage("success", colorize(message, COLORS.GREEN)));
  }

  warn(message: string): void {
    console.warn(this.formatMessage("warn", colorize(message, COLORS.YELLOW)));
  }

  error(message: string, error?: unknown): void {
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
    console.error(this.formatMessage("error", colorize(detailedMessage, COLORS.RED)));
  }

  debug(message: string): void {
    console.log(this.formatMessage("debug", colorize(message, COLORS.MAGENTA)));
  }
}
