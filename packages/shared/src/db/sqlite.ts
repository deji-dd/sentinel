import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * SQLite database connection singleton
 * Replaces Supabase to avoid egress limits
 */
class SQLiteDB {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor() {
    // Get database path from environment or use default
    this.dbPath =
      process.env.SQLITE_DB_PATH || join(process.cwd(), "data", "sentinel.db");
  }

  /**
   * Get or create the database connection
   * Enforces WAL mode for concurrent read/writes
   */
  getConnection(): Database.Database {
    if (this.db) {
      return this.db;
    }

    console.log(`[SQLite] Initializing database at: ${this.dbPath}`);

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
   * Check if database is empty and execute schema creation if needed
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
      console.log("[SQLite] Database is empty, executing schema creation...");

      // Read and execute schema file
      const schemaPath = join(__dirname, "..", "..", "..", "sqlite-schema.sql");
      const schema = readFileSync(schemaPath, "utf-8");

      // Execute schema in a transaction for atomicity
      this.db.exec(schema);

      console.log("[SQLite] Schema created successfully");
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
