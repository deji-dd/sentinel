/**
 * Migration: Convert id columns from INTEGER to TEXT for collision-free UUIDs
 *
 * This migration safely converts the following tables:
 * - sentinel_rate_limit_requests_per_user: id INTEGER → TEXT
 * - sentinel_worker_logs: id INTEGER → TEXT
 *
 * Data preservation strategy:
 * - Existing integer ids are converted to text strings
 * - New rows will use UUID strings
 * - Foreign key constraints temporarily disabled during migration
 *
 * Usage: npx tsx src/scripts/migrate-id-types-to-text.ts
 */

import { getDB, getKysely } from "@sentinel/shared/db/sqlite.js";
import { TABLE_NAMES } from "@sentinel/shared";

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function migrateTable(
  tableName: string,
  idColumnName: string = "id",
): Promise<void> {
  const db = getDB();
  const kdb = getKysely();
  const quoted = quoteIdentifier(tableName);
  const idQuoted = quoteIdentifier(idColumnName);

  console.log(`\n📋 Migrating ${tableName}...`);

  // Disable foreign keys temporarily
  db.exec("PRAGMA foreign_keys = OFF");

  try {
    // Count existing rows
    const beforeCountRow = await kdb
      .selectFrom(tableName as never)
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();
    const beforeCount = { count: Number(beforeCountRow.count) };

    console.log(`  ✓ Found ${beforeCount.count} existing rows`);

    // Create backup table
    const backupTable = `${tableName}_backup`;
    const backupQuoted = quoteIdentifier(backupTable);

    console.log(`  → Creating backup table: ${backupTable}`);
    db.exec(`
      DROP TABLE IF EXISTS ${backupQuoted};
      CREATE TABLE ${backupQuoted} AS SELECT * FROM ${quoted};
    `);

    // Get column definitions (excluding the id column)
    const tableInfo = db.pragma(`table_info(${quoted})`) as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;

    // Build CREATE TABLE statement with TEXT id
    let createStmt = `CREATE TABLE ${quoted} (`;
    const columnDefs: string[] = [];

    for (const col of tableInfo) {
      if (col.name === idColumnName) {
        // Change id to TEXT
        columnDefs.push(`  ${idQuoted} TEXT NOT NULL`);
      } else {
        // Keep other columns as-is
        let colDef = `  ${quoteIdentifier(col.name)} ${col.type}`;
        if (col.notnull) {
          colDef += " NOT NULL";
        }
        if (col.dflt_value !== null) {
          colDef += ` DEFAULT ${col.dflt_value}`;
        }
        columnDefs.push(colDef);
      }
    }

    createStmt += columnDefs.join(",\n") + "\n)";

    console.log(`  → Dropping old table`);
    db.exec(`DROP TABLE IF EXISTS ${quoted}`);

    console.log(`  → Creating new table with TEXT id column`);
    db.exec(createStmt);

    // Recreate indexes (query depends on table)
    if (tableName === TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER) {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS sentinel_rate_limit_requests_per_user_pkey 
          ON ${quoted} (id);
      `);
    } else if (tableName === TABLE_NAMES.WORKER_LOGS) {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS sentinel_worker_logs_pkey 
          ON ${quoted} (id);
      `);
    }

    // Copy data back, converting id to TEXT
    console.log(`  → Migrating data (converting ids to TEXT)`);
    const nonIdColumns = tableInfo
      .filter((col) => col.name !== idColumnName)
      .map((col) => quoteIdentifier(col.name));

    const selectList = [
      `CAST(${idQuoted} AS TEXT)`, // Convert INTEGER id to TEXT
      ...nonIdColumns,
    ];

    db.exec(`
      INSERT INTO ${quoted} (${idQuoted}, ${nonIdColumns.join(", ")})
      SELECT ${selectList.join(", ")}
      FROM ${backupQuoted}
    `);

    // Verify data integrity
    const afterCountRow = await kdb
      .selectFrom(tableName as never)
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();
    const afterCount = { count: Number(afterCountRow.count) };

    if (afterCount.count === beforeCount.count) {
      console.log(`  ✅ Data migration successful (${afterCount.count} rows)`);

      // Clean up backup
      db.exec(`DROP TABLE ${backupQuoted}`);
      console.log(`  🗑️  Backup table cleaned up`);
    } else {
      throw new Error(
        `Data loss detected! Before: ${beforeCount.count}, After: ${afterCount.count}`,
      );
    }
  } catch (error) {
    console.error(`  ❌ Migration failed for ${tableName}:`, error);
    db.exec("PRAGMA foreign_keys = ON");
    throw error;
  }

  db.exec("PRAGMA foreign_keys = ON");
}

async function main(): Promise<void> {
  console.log("🚀 Starting id type migration...\n");

  const db = getDB();

  // Backup the entire database file
  console.log("📦 Creating database backup...");
  const fs = await import("fs");
  const path = await import("path");
  const dbPath = (db as { name?: string }).name || "./data/sentinel-local.db";
  const backupPath = path.join(
    path.dirname(dbPath),
    `sentinel-local-backup-${Date.now()}.db`,
  );

  try {
    fs.copyFileSync(dbPath, backupPath);
    console.log(`  ✅ Backup created: ${backupPath}`);
  } catch (error) {
    console.error("  ❌ Failed to create backup:", error);
    process.exit(1);
  }

  console.log("  ⚠️  Ensure this backup is stored safely before proceeding!\n");

  try {
    // Migrate tables
    await migrateTable(TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER);
    await migrateTable(TABLE_NAMES.WORKER_LOGS);

    console.log("\n✅ Migration complete!");
    console.log(
      "   - All id columns are now TEXT (compatible with UUID generation)",
    );
    console.log("   - Existing data preserved with ids converted to text");
    console.log("   - Ready for deployment\n");
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    console.error(
      "\nTo restore from backup, run:",
      `cp ${backupPath} ./data/sentinel-local.db`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
