// packages/shared/src/utils/logger.ts
// Define a list of bright ANSI colors
const COLORS = [
  "\x1b[36m", // Cyan
  "\x1b[32m", // Green
  "\x1b[33m", // Yellow
  "\x1b[34m", // Blue
  "\x1b[35m", // Magenta
];
const RESET = "\x1b[0m";

// Pick one random color for this specific Node.js process upon boot
const PROCESS_COLOR = COLORS[Math.floor(Math.random() * COLORS.length)];

export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    // Wrap the context and level in the unique process color
    return `${PROCESS_COLOR}[${timestamp}] [${level}] [${this.context}]${RESET} ${message}`;
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
  time(label: string) {
    const start = performance.now();
    return (message?: string) => {
      const duration = (performance.now() - start).toFixed(2);
      this.info(`${label} - ${message || "completed"} in ${duration}ms`);
    };
  }
}
