#!/usr/bin/env node
/**
 * Converts PostgreSQL schema dump to SQLite schema
 * Only extracts tables defined in TABLE_NAMES constant
 */

const fs = require("fs");
const path = require("path");

// Tables we're using (from packages/shared/src/constants.ts)
const TABLES_TO_EXTRACT = [
  "sentinel_users",
  "sentinel_user_data",
  "sentinel_user_bars",
  "sentinel_user_cooldowns",
  "sentinel_travel_data",
  "sentinel_travel_recommendations",
  "sentinel_travel_settings",
  "sentinel_travel_stock_cache",
  "sentinel_workers",
  "sentinel_worker_schedules",
  "sentinel_worker_logs",
  "sentinel_torn_items",
  "sentinel_torn_categories",
  "sentinel_torn_gyms",
  "sentinel_torn_destinations",
  "sentinel_destination_travel_times",
  "sentinel_rate_limit_requests_per_user",
  "sentinel_system_api_keys",
  "sentinel_guild_api_keys",
  "sentinel_api_key_user_mapping",
  "sentinel_user_alerts",
  "sentinel_user_snapshots",
  "sentinel_finance_settings",
  "sentinel_training_recommendations",
  "sentinel_stat_builds",
  "sentinel_stat_build_configurations",
  "sentinel_user_build_preferences",
  "sentinel_verified_users",
  "sentinel_battlestats_snapshots",
  "sentinel_guild_config",
  "sentinel_guild_sync_jobs",
  "sentinel_guild_audit",
  "sentinel_faction_roles",
  "sentinel_territory_blueprint",
  "sentinel_territory_state",
  "sentinel_war_ledger",
  "sentinel_war_trackers",
  "sentinel_torn_factions",
  "sentinel_tt_config",
  "sentinel_reaction_role_messages",
  "sentinel_reaction_role_mappings",
  "sentinel_reaction_role_config",
  "sentinel_revive_config",
  "sentinel_revive_requests",
];

function convertPostgresToSQLite(pgSQL) {
  let sql = pgSQL;

  // Convert table constraints from ALTER TABLE into SQLite-compatible unique indexes.
  // SQLite cannot add PRIMARY KEY via ALTER TABLE after creation, but unique indexes
  // satisfy ON CONFLICT targets and preserve uniqueness semantics.
  sql = sql.replace(
    /ALTER TABLE ONLY\s+(?:"public"\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+ADD CONSTRAINT\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+(?:PRIMARY KEY|UNIQUE)\s*\(([^\)]+)\);/gi,
    (_match, tableName, constraintName, columns) =>
      `CREATE UNIQUE INDEX IF NOT EXISTS "${constraintName}" ON "${tableName}" (${columns});`,
  );

  // Remove schema qualifiers
  sql = sql.replace(/IF NOT EXISTS "public"\./g, "IF NOT EXISTS ");
  sql = sql.replace(/"public"\./g, "");

  // Remove ALTER TABLE OWNER statements
  sql = sql.replace(/ALTER TABLE .* OWNER TO .*;/g, "");

  // Remove SET statements
  sql = sql.replace(/^SET .*;$/gm, "");

  // Remove CREATE SCHEMA
  sql = sql.replace(/CREATE SCHEMA IF NOT EXISTS "public";/g, "");
  sql = sql.replace(/ALTER SCHEMA "public" OWNER TO .*;/g, "");

  // Remove COMMENT statements
  sql = sql.replace(/COMMENT ON .* IS .*;/g, "");

  // Remove functions (SQLite doesn't support stored procedures)
  sql = sql.replace(
    /CREATE OR REPLACE FUNCTION[\s\S]*?(?=CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE|$)/g,
    "",
  );
  sql = sql.replace(/ALTER FUNCTION .* OWNER TO .*;/g, "");

  // Remove DROP TRIGGER statements
  sql = sql.replace(/DROP TRIGGER IF EXISTS .* ON .*;/g, "");

  // Remove CREATE TRIGGER statements (we'll handle timestamps in application code)
  sql = sql.replace(
    /CREATE TRIGGER[\s\S]*?(?=CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE|$)/g,
    "",
  );

  // Remove ::TYPE casts BEFORE converting type names (handles '{}'::"text"[], etc.)
  sql = sql.replace(/::("[a-zA-Z_]+"|\w+)(\[\])?/g, "");

  // Remove PostgreSQL interval expressions like ("now"() + '00:05:00'::interval) or (now() + interval)
  // Must be done early while quotes still present
  sql = sql.replace(/DEFAULT \("?now"?\(\) \+ '[^']+'\)/gi, "");

  // Convert array TYPE declarations to TEXT.
  // Keep ARRAY[] literals intact so they can be rewritten to JSON defaults later.
  sql = sql.replace(/("[a-zA-Z_]+"|[a-zA-Z_]+)\s*\[\]/gi, (full, ident) => {
    const normalized = String(ident).replace(/^"|"$/g, "").toLowerCase();
    return normalized === "array" ? full : "TEXT";
  });

  // Convert data types
  sql = sql.replace(/\bbigint\b/gi, "INTEGER");
  sql = sql.replace(/\bsmallint\b/gi, "INTEGER");
  sql = sql.replace(/\binteger\b/gi, "INTEGER");
  sql = sql.replace(/\breal\b/gi, "REAL");
  sql = sql.replace(/\bdouble precision\b/gi, "REAL");
  sql = sql.replace(/\bnumeric(\(\d+,\d+\))?/gi, "REAL");
  sql = sql.replace(/\bbigserial\b/gi, "INTEGER");
  sql = sql.replace(/\bserial\b/gi, "INTEGER");
  sql = sql.replace(/\bcharacter varying(\(\d+\))?/gi, "TEXT");
  sql = sql.replace(/\bvarchar(\(\d+\))?/gi, "TEXT");
  sql = sql.replace(/\btext\b/gi, "TEXT");
  sql = sql.replace(/\btimestamp with time zone\b/gi, "TEXT");
  sql = sql.replace(/\btimestamp without time zone\b/gi, "TEXT");
  sql = sql.replace(/\btimestamp\b/gi, "TEXT");
  sql = sql.replace(/\bdate\b/gi, "TEXT");
  sql = sql.replace(/\btime\b/gi, "TEXT");
  sql = sql.replace(/\bboolean\b/gi, "INTEGER");
  sql = sql.replace(/\bjsonb\b/gi, "TEXT");
  sql = sql.replace(/\bjson\b/gi, "TEXT");
  sql = sql.replace(/\buuid\b/gi, "TEXT");

  // Convert DEFAULT "now"() or DEFAULT now() to CURRENT_TIMESTAMP
  sql = sql.replace(/DEFAULT "?now"?\(\)/g, "DEFAULT CURRENT_TIMESTAMP");

  // Convert DEFAULT true/false to 1/0
  sql = sql.replace(/DEFAULT true/g, "DEFAULT 1");
  sql = sql.replace(/DEFAULT false/g, "DEFAULT 0");

  // Remove "gen_random_uuid"() or gen_random_uuid() - SQLite will handle it in application code
  sql = sql.replace(/DEFAULT "?gen_random_uuid"?\(\)/g, "");

  // Convert PostgreSQL array defaults to JSON array format
  sql = sql.replace(/DEFAULT ARRAY\[\]/gi, "DEFAULT '[]'");
  sql = sql.replace(/DEFAULT '\{\}'/g, "DEFAULT '[]'");

  // Simplify CHECK constraints to SQLite syntax
  sql = sql.replace(/CHECK \(\([^)]+= ANY \(ARRAY\[([^\]]+)\]\)\)\)/g, "");

  // Remove PostgreSQL-specific constraints
  sql = sql.replace(/CONSTRAINT ".*?" /g, "");

  // Remove PostgreSQL index method clauses
  sql = sql.replace(/USING\s+"?btree"?\s*/gi, "");

  // Remove quotes from table and column names (SQLite doesn't require them)
  sql = sql.replace(/"([a-zA-Z_][a-zA-Z0-9_]*)"/g, "$1");

  // Remove trailing commas before closing parentheses (fixes syntax errors)
  sql = sql.replace(/,(\s*\n\s*)\);/g, "$1);");

  // Clean up whitespace
  sql = sql.replace(/\n\n\n+/g, "\n\n");
  sql = sql.trim();

  return sql;
}

function extractTableStatements(dumpContent, tableName) {
  const statements = [];

  // Extract CREATE TABLE statement
  const tableRegex = new RegExp(
    `CREATE TABLE[^;]*?${tableName}[^;]*?\\([\\s\\S]*?\\);`,
    "i",
  );
  const tableMatch = dumpContent.match(tableRegex);
  if (tableMatch) {
    statements.push(tableMatch[0]);
  }

  // Extract CREATE INDEX statements for this table
  const indexRegex = new RegExp(
    `CREATE(?: UNIQUE)? INDEX[^;]*? ON (?:"public"\\.|)${tableName}[^;]*?;`,
    "gi",
  );
  const indexMatches = dumpContent.matchAll(indexRegex);
  for (const match of indexMatches) {
    statements.push(match[0]);
  }

  // Convert PRIMARY KEY / UNIQUE constraints into SQLite unique indexes.
  // This preserves ON CONFLICT compatibility for runtime upserts.
  const escapedTableName = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const constraintRegex = new RegExp(
    `ALTER TABLE ONLY\\s+"public"\\."${escapedTableName}"\\s+ADD CONSTRAINT\\s+"([^"]+)"\\s+(PRIMARY KEY|UNIQUE)\\s*\\(([^\\)]+)\\);`,
    "gi",
  );

  const constraintMatches = dumpContent.matchAll(constraintRegex);
  for (const match of constraintMatches) {
    const constraintName = match[1];
    const columns = match[3];
    statements.push(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${constraintName}" ON "public"."${tableName}" (${columns});`,
    );
  }

  return statements.join("\n\n");
}

async function main() {
  const dumpPath = path.join(__dirname, "..", "postgres-schema-dump.sql");
  const outputPath = path.join(__dirname, "..", "sqlite-schema.sql");

  console.log("Reading PostgreSQL schema dump...");
  const dumpContent = fs.readFileSync(dumpPath, "utf-8");

  console.log("Extracting and converting tables...");
  const sqliteStatements = [];

  sqliteStatements.push("-- SQLite schema converted from PostgreSQL dump");
  sqliteStatements.push("-- Generated: " + new Date().toISOString());
  sqliteStatements.push("");
  sqliteStatements.push("PRAGMA foreign_keys = OFF;");
  sqliteStatements.push("");

  for (const tableName of TABLES_TO_EXTRACT) {
    console.log(`  Processing ${tableName}...`);
    const tableSQL = extractTableStatements(dumpContent, tableName);
    if (tableSQL) {
      sqliteStatements.push(`-- Table: ${tableName}`);
      sqliteStatements.push(tableSQL);
      sqliteStatements.push("");
    } else {
      console.warn(`  WARNING: Table ${tableName} not found in dump`);
    }
  }

  sqliteStatements.push("PRAGMA foreign_keys = ON;");

  // Convert all SQL at once to ensure consistent transformations
  const finalSQL = convertPostgresToSQLite(sqliteStatements.join("\n"));

  console.log("Writing SQLite schema...");
  fs.writeFileSync(outputPath, finalSQL, "utf-8");

  console.log(`\nDone! SQLite schema written to: ${outputPath}`);
  console.log(`Total tables converted: ${TABLES_TO_EXTRACT.length}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
