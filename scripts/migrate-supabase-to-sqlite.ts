#!/usr/bin/env tsx
// @ts-nocheck
/**
 * Supabase to SQLite Migration Script
 *
 * Connects to Supabase PRODUCTION database and migrates all data to SQLite.
 * Run with: tsx --env-file=apps/worker/.env scripts/migrate-supabase-to-sqlite.ts
 *
 * Requirements:
 * - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (production credentials)
 * - SQLITE_DB_PATH or SQLITE_DB_PATH_LOCAL in .env (optional, defaults to ./data/sentinel.db)
 * - NODE_ENV set to 'production' to connect to prod Supabase and prod SQLite
 */

import { createClient } from "@supabase/supabase-js";
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join } from "path";
import { TABLE_NAMES } from "../packages/shared/src/constants.js";

// Configuration
const BATCH_SIZE = 1000; // Read and write in pages to avoid API limits and memory spikes.
const TABLES_TO_MIGRATE = Object.values(TABLE_NAMES);

interface MigrationStats {
  table: string;
  rowCount: number;
  success: boolean;
  error?: string;
  duration: number;
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toSQLiteValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    return JSON.stringify(value);
  }

  return value;
}

function resolveSupabaseCredentials(nodeEnv: string): {
  url: string | undefined;
  key: string | undefined;
} {
  if (nodeEnv === "development") {
    return {
      url: process.env.SUPABASE_URL_LOCAL ?? process.env.SUPABASE_URL,
      key:
        process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL ??
        process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
  }

  return {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function resolveSQLitePath(nodeEnv: string): string {
  if (nodeEnv === "development") {
    return (
      process.env.SQLITE_DB_PATH_LOCAL ||
      join(process.cwd(), "data", "sentinel-local.db")
    );
  }

  return (
    process.env.SQLITE_DB_PATH || join(process.cwd(), "data", "sentinel.db")
  );
}

function initializeSchemaIfEmpty(db: Database.Database): void {
  const tableCount = db
    .prepare(
      "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .get() as { count: number };

  if (tableCount.count > 0) {
    return;
  }

  const schemaPath = join(process.cwd(), "sqlite-schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  db.exec(schema);
}

async function main() {
  console.log("=".repeat(80));
  console.log("SUPABASE TO SQLITE MIGRATION");
  console.log("=".repeat(80));
  console.log();

  // Validate environment
  const nodeEnv = process.env.NODE_ENV || "development";
  const { url: supabaseUrl, key: supabaseKey } =
    resolveSupabaseCredentials(nodeEnv);

  if (!supabaseUrl || !supabaseKey) {
    console.error("ERROR: Missing Supabase credentials");
    if (nodeEnv === "development") {
      console.error(
        "Required: SUPABASE_URL_LOCAL/SUPABASE_SERVICE_ROLE_KEY_LOCAL (or SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fallback)",
      );
    } else {
      console.error("Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    }
    console.error(
      "Run with: pnpm --filter worker exec tsx --env-file=.env ../../scripts/migrate-supabase-to-sqlite.ts",
    );
    process.exit(1);
  }

  console.log(`Environment: ${nodeEnv}`);
  console.log(`Supabase URL: ${supabaseUrl}`);

  // Determine SQLite path based on environment
  const sqlitePath = resolveSQLitePath(nodeEnv);
  console.log(`SQLite path: ${sqlitePath}`);
  console.log();

  // Connect to Supabase
  console.log("Connecting to Supabase...");
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  // Connect to SQLite
  console.log("Connecting to SQLite...");
  const db = new Database(sqlitePath);

  // Enable WAL mode
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  // Disable FK checks during bulk load, then enable after all tables are inserted.
  db.pragma("foreign_keys = OFF");

  initializeSchemaIfEmpty(db);

  console.log("Database connections established");
  console.log();

  // Migration stats
  const stats: MigrationStats[] = [];
  let totalRows = 0;
  let successCount = 0;
  let failCount = 0;

  // Migrate each table
  for (const tableName of TABLES_TO_MIGRATE) {
    const startTime = Date.now();

    try {
      console.log(`\nMigrating table: ${tableName}`);
      console.log("-".repeat(80));

      let migratedRows = 0;
      let page = 0;
      let insertMany: Database.Transaction<
        (dataRows: Record<string, unknown>[]) => void
      > | null = null;

      while (true) {
        const from = page * BATCH_SIZE;
        const to = from + BATCH_SIZE - 1;

        console.log(`  Fetching rows ${from}-${to}...`);
        const { data: rows, error } = await supabase
          .from(tableName)
          .select("*")
          .range(from, to);

        if (error) {
          throw new Error(`Supabase error: ${error.message}`);
        }

        if (!rows || rows.length === 0) {
          if (page === 0) {
            console.log("  Table is empty, skipping");
          }
          break;
        }

        if (!insertMany) {
          const columns = Object.keys(rows[0]);
          const placeholders = columns.map(() => "?").join(", ");
          const tableIdentifier = quoteIdentifier(tableName);
          const columnsList = columns.map(quoteIdentifier).join(", ");
          const insertSQL = `INSERT OR REPLACE INTO ${tableIdentifier} (${columnsList}) VALUES (${placeholders})`;
          const insertStmt = db.prepare(insertSQL);

          insertMany = db.transaction((dataRows: Record<string, unknown>[]) => {
            for (const row of dataRows) {
              const values = columns.map((col) => toSQLiteValue(row[col]));
              insertStmt.run(...values);
            }
          });
        }

        insertMany(rows as Record<string, unknown>[]);
        migratedRows += rows.length;
        console.log(
          `  Inserted batch: ${rows.length} rows (total ${migratedRows})`,
        );

        if (rows.length < BATCH_SIZE) {
          break;
        }

        page += 1;
      }

      const duration = Date.now() - startTime;
      console.log(`  Migrated ${migratedRows} rows in ${duration}ms`);

      stats.push({
        table: tableName,
        rowCount: migratedRows,
        success: true,
        duration,
      });

      totalRows += migratedRows;
      successCount++;
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      console.log(`  Failed: ${errorMessage}`);

      stats.push({
        table: tableName,
        rowCount: 0,
        success: false,
        error: errorMessage,
        duration,
      });

      failCount++;
    }
  }

  db.pragma("foreign_keys = ON");

  // Close connections
  db.close();

  // Print summary
  console.log("\n" + "=".repeat(80));
  console.log("MIGRATION SUMMARY");
  console.log("=".repeat(80));
  console.log();

  console.log(`Successful: ${successCount}/${TABLES_TO_MIGRATE.length} tables`);
  console.log(`Failed: ${failCount}/${TABLES_TO_MIGRATE.length} tables`);
  console.log(`Total rows migrated: ${totalRows.toLocaleString()}`);
  console.log();

  if (failCount > 0) {
    console.log("Failed tables:");
    stats
      .filter((s) => !s.success)
      .forEach((s) => {
        console.log(`  - ${s.table}: ${s.error}`);
      });
    console.log();
  }

  console.log("Top 10 largest tables:");
  stats
    .sort((a, b) => b.rowCount - a.rowCount)
    .slice(0, 10)
    .forEach((s, i) => {
      console.log(
        `  ${i + 1}. ${s.table}: ${s.rowCount.toLocaleString()} rows (${s.duration}ms)`,
      );
    });

  console.log();
  console.log("=".repeat(80));

  if (failCount > 0) {
    console.log("Migration completed with errors");
    process.exit(1);
  } else {
    console.log("Migration completed successfully");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("\nFATAL ERROR:");
  console.error(err);
  process.exit(1);
});
