import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Find the workspace root by looking for pnpm-workspace.yaml
 */
function findWorkspaceRoot(): string {
  let currentDir = process.cwd();

  // Walk up the directory tree looking for pnpm-workspace.yaml
  while (currentDir !== dirname(currentDir)) {
    const workspaceFile = join(currentDir, "pnpm-workspace.yaml");
    if (existsSync(workspaceFile)) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }

  // Fallback to current directory if not found
  return process.cwd();
}

function resolveDatabasePath(
  candidatePath: string,
  workspaceRoot: string,
): string {
  if (!candidatePath) {
    return candidatePath;
  }

  // Keep absolute paths unchanged
  if (candidatePath.startsWith("/")) {
    return candidatePath;
  }

  // Resolve relative paths from workspace root so all apps target the same DB.
  return resolve(workspaceRoot, candidatePath);
}

/**
 * SQLite database connection singleton
 * Shared SQLite connection manager
 *
 * Environment-aware configuration:
 * - Development (NODE_ENV=development): Uses SQLITE_DB_PATH_LOCAL or ./data/sentinel-local.db
 * - Production (NODE_ENV=production): Uses SQLITE_DB_PATH or ./data/sentinel.db
 */
class SQLiteDB {
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private readonly environment: string;

  constructor() {
    this.environment = process.env.NODE_ENV || "development";

    // Find workspace root for monorepo support
    const workspaceRoot = findWorkspaceRoot();

    // Determine database path based on environment
    if (this.environment === "development") {
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
  }

  /**
   * Get or create the database connection
   * Enforces WAL mode for concurrent read/writes
   */
  getConnection(): Database.Database {
    if (this.db) {
      return this.db;
    }

    console.log(
      `[SQLite] Initializing database (${this.environment}) at: ${this.dbPath}`,
    );

    // Ensure data directory exists
    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      console.log(`[SQLite] Creating directory: ${dbDir}`);
      mkdirSync(dbDir, { recursive: true });
    }

    // Create database connection
    this.db = new Database(this.dbPath);

    // CRITICAL: Enable WAL mode for concurrent reads/writes
    this.db.pragma("journal_mode = WAL");

    // Additional performance optimizations
    this.db.pragma("synchronous = NORMAL"); // Faster writes, still safe with WAL
    this.db.pragma("cache_size = -64000"); // 64MB cache
    this.db.pragma("temp_store = MEMORY"); // Use memory for temp tables

    // Check if database is empty and initialize schema if needed
    this.initializeSchemaIfEmpty();

    console.log("[SQLite] Database initialized successfully");

    return this.db;
  }

  /**
   * Check if database is empty and log status
   * Schema initialization is now handled by migration system
   */
  private initializeSchemaIfEmpty(): void {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    // Check if any tables exist
    const tableCount = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .get() as { count: number };

    if (tableCount.count === 0) {
      console.log(
        "[SQLite] Database is empty. Run migrations with 'pnpm sqlite:migrate' to initialize schema.",
      );
    } else {
      console.log(
        `[SQLite] Database already initialized with ${tableCount.count} tables`,
      );
    }
  }

  /**
   * Close the database connection
   * Call this on graceful shutdown
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log("[SQLite] Database connection closed");
    }
  }

  /**
   * Execute a raw SQL query
   * Useful for migrations or maintenance
   */
  exec(sql: string): void {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    this.db.exec(sql);
  }
}

// Export singleton instance
export const sqliteDB = new SQLiteDB();

// Export db getter for convenience
export function getDB(): Database.Database {
  return sqliteDB.getConnection();
}

// Graceful shutdown handler
process.on("SIGINT", () => {
  console.log("\n[SQLite] Received SIGINT, closing database...");
  sqliteDB.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[SQLite] Received SIGTERM, closing database...");
  sqliteDB.close();
  process.exit(0);
});
