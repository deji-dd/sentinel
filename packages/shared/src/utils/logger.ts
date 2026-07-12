// packages/shared/src/utils/logger.ts
// Define a list of bright ANSI colors
const COLORS = [
  "\x1b[36m", // Cyan
  "\x1b[34m", // Blue
  "\x1b[97m", // Bright White
  "\x1b[35m", // Magenta
  "\x1b[96m", // Bright Cyan
  "\x1b[94m", // Bright Blue
  "\x1b[95m", // Bright Magenta
  "\x1b[38;5;39m",  // Deep Blue
  "\x1b[38;5;45m",  // Light Blue
  "\x1b[38;5;51m",  // Bright Cyan
  "\x1b[38;5;75m",  // Soft Blue
  "\x1b[38;5;87m",  // Soft Cyan
  "\x1b[38;5;111m", // Sky Blue
  "\x1b[38;5;117m", // Light Sky Blue
  "\x1b[38;5;141m", // Light Purple
  "\x1b[38;5;147m", // Soft Purple
  "\x1b[38;5;153m", // Very Light Blue
  "\x1b[38;5;159m", // Very Light Cyan
  "\x1b[38;5;183m", // Pale Purple
  "\x1b[38;5;207m", // Hot Pink
  "\x1b[38;5;213m", // Pink
  "\x1b[38;5;219m", // Light Pink
];
const RESET = "\x1b[0m";

const LEVEL_COLORS: Record<string, string> = {
  INFO: "\x1b[32m", // Green
  WARN: "\x1b[33m", // Yellow
  ERROR: "\x1b[31m", // Red
  DEBUG: "\x1b[35m", // Magenta
};

let colorIndex = 0;

export class Logger {
  private context: string;
  private processColor: string;

  constructor(context: string, processColor?: string) {
    this.context = context;
    if (processColor) {
      this.processColor = processColor;
    } else {
      this.processColor = COLORS[colorIndex % COLORS.length];
      colorIndex++;
    }
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toLocaleString();
    const LEVEL_COLOR = LEVEL_COLORS[level] || RESET;
    return `[${timestamp}] ${LEVEL_COLOR}[${level}] ${RESET}${this.processColor}[${this.context}] ${RESET}${message}`;
  }

  info(message: string, ...meta: any[]): void {
    console.log(this.formatMessage("INFO", message), ...meta);
  }

  warn(message: string, ...meta: any[]): void {
    console.warn(this.formatMessage("WARN", message), ...meta);
  }

  error(message: string, error?: any): void {
    console.error(this.formatMessage("ERROR", message), error || "");
  }

  debug(message: string, ...meta: any[]): void {
    if (process.env.NODE_ENV !== "production") {
      console.debug(this.formatMessage("DEBUG", message), ...meta);
    }
  }

  // Timer utility for profiling slow API calls
  time() {
    this.info("Started");
    const start = performance.now();
    return () => {
      const durationMs = performance.now() - start;
      let formattedDuration = "";

      if (durationMs >= 60000) {
        formattedDuration = `${(durationMs / 60000).toFixed(2)}m`;
      } else if (durationMs >= 1000) {
        formattedDuration = `${(durationMs / 1000).toFixed(2)}s`;
      } else {
        formattedDuration = `${durationMs.toFixed(2)}ms`;
      }

      this.info(`Completed in ${formattedDuration}`);
    };
  }
}
