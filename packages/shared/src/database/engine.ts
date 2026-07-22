import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";

/**
 * Lightweight internal logger for database lifecycle events.
 */
function logSQLite(message: string): void {
  const COLORS = { DIM: "\x1b[2m", RESET: "\x1b[0m", GREEN: "\x1b[32m" };
  const timestamp = `${COLORS.DIM}${new Date().toLocaleTimeString("en-US", { hour12: false })}${COLORS.RESET}`;
  const prefix = `${COLORS.GREEN}[SQLite]${COLORS.RESET}`;
  console.debug(`${prefix} ${timestamp}: ${message}`);
}

/**
 * Ascends the directory tree from the Current Working Directory (CWD)
 * to locate the monorepo root marked by `pnpm-workspace.yaml`.
 * @returns {string} The absolute path to the workspace root.
 */
function findWorkspaceRoot(): string {
  let currentDir = process.cwd();
  while (currentDir !== dirname(currentDir)) {
    const workspaceFile = join(currentDir, "pnpm-workspace.yaml");
    if (existsSync(workspaceFile)) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }
  return process.cwd();
}

/**
 * Safely resolves a database path against the workspace root.
 * @param candidatePath - The relative or absolute path from environment variables.
 * @param workspaceRoot - The resolved absolute root of the monorepo.
 * @returns {string} The fully resolved absolute path.
 */
function resolveDatabasePath(
  candidatePath: string,
  workspaceRoot: string,
): string {
  if (!candidatePath) return candidatePath;
  if (candidatePath.startsWith("/")) return candidatePath;
  return resolve(workspaceRoot, candidatePath);
}

/**
 * The core connection manager for the localized Sentinel SQLite database.
 * Automatically enforces high-concurrency PRAGMAs (WAL mode, memory mapping).
 */
export class SentinelDatabase {
  public db: Database.Database;
  private readonly dbPath: string;

  /**
   * Instantiates a new high-performance SQLite connection.
   * @param customPath - Optional path override (used heavily in migration scripts). If omitted, uses standard ENV monorepo resolution.
   */
  constructor(customPath?: string) {
    const environment = process.env.NODE_ENV || "production";
    const workspaceRoot = findWorkspaceRoot();

    if (customPath) {
      this.dbPath = resolve(workspaceRoot, customPath);
    } else if (environment === "development") {
      this.dbPath = resolveDatabasePath(
        process.env.SQLITE_DB_PATH_LOCAL || "./data/sentinel-local.db",
        workspaceRoot,
      );
    } else {
      this.dbPath = resolveDatabasePath(
        process.env.SQLITE_DB_PATH || "./data/sentinel.db",
        workspaceRoot,
      );
    }

    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      logSQLite(`Directory missing. Creating path: ${dbDir}`);
      mkdirSync(dbDir, { recursive: true });
    }

    logSQLite(`Initializing connection at: ${this.dbPath}`);
    this.db = new Database(this.dbPath, { timeout: 7000 });
    this.optimizeEngine();
    logSQLite("Engine optimized and ready.");
  }

  /**
   * Applies SQLite memory and concurrency optimizations.
   * Configures Write-Ahead Logging (WAL) for non-blocking concurrent reads/writes.
   */
  private optimizeEngine() {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    const isProd = process.env.NODE_ENV === "production";

    // Default to -25000 (25MB) for dev, -100000 (100MB) for prod, or custom env value
    const cacheSize =
      process.env.SQLITE_CACHE_SIZE || (isProd ? "-750000" : "-250000");
    // Default to 256MB for dev, 1GB for prod, or custom env value
    const mmapSize =
      process.env.SQLITE_MMAP_SIZE || (isProd ? "1073741824" : "1073741824");

    this.db.pragma(`cache_size = ${cacheSize}`);
    this.db.pragma(`mmap_size = ${mmapSize}`);
    this.db.pragma("temp_store = MEMORY");
    this.db.pragma("busy_timeout = 7000");
  }

  /**
   * Physically rebuilds the database file to reclaim disk space and optimizes query plans.
   * @warning Should strictly be called from a dedicated cron job, never mid-process during high traffic.
   */
  public optimizeDiskSpace() {
    logSQLite("Executing routine VACUUM and disk space optimization...");
    this.db.exec("VACUUM");
    this.db.exec("PRAGMA optimize");
    logSQLite("Disk space optimization complete.");
  }

  /**
   * Safely closes the active database connection.
   */
  public close() {
    this.db.close();
    logSQLite("Connection safely closed.");
  }
}

export const sentinelDbEngine = new SentinelDatabase();
