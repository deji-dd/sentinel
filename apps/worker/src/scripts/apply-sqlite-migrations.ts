#!/usr/bin/env tsx
import { readdirSync, readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getDB, getKysely } from "@sentinel/shared/db/sqlite.js";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findRepoRoot(): string {
  // apps/worker/src/scripts -> repo root
  return join(__dirname, "..", "..", "..", "..");
}

function ensureMigrationsTable(): void {
  const db = getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sentinel_schema_migrations (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checksum TEXT NOT NULL
    );
  `);
}

function checksum(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function getMigrationFiles(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

function splitSqlStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    const prev = i > 0 ? sqlText[i - 1] : "";

    if (char === "'" && !inDoubleQuote && prev !== "\\") {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && prev !== "\\") {
      inDoubleQuote = !inDoubleQuote;
    }

    if (char === ";" && !inSingleQuote && !inDoubleQuote) {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
}

function isSafeDuplicateColumnError(
  error: unknown,
  statement: string,
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const isAlterAddColumn = /^\s*ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\s+/i.test(
    statement,
  );

  if (!isAlterAddColumn) {
    return false;
  }

  return /duplicate column name/i.test(error.message);
}

function executeMigrationSql(
  db: ReturnType<typeof getDB>,
  sqlText: string,
): void {
  const statements = splitSqlStatements(sqlText);

  for (const statement of statements) {
    try {
      db.exec(statement);
    } catch (error) {
      if (isSafeDuplicateColumnError(error, statement)) {
        console.warn(
          `[sqlite:migrate] Skipping duplicate-column ALTER TABLE statement: ${statement}`,
        );
        continue;
      }

      throw error;
    }
  }
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const migrationsDir = join(repoRoot, "sqlite", "migrations");
  const db = getDB();
  const kdb = getKysely();

  ensureMigrationsTable();

  const files = getMigrationFiles(migrationsDir);
  if (files.length === 0) {
    console.log("[sqlite:migrate] No migration files found.");
    return;
  }

  let appliedCount = 0;

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const sqlText = readFileSync(filePath, "utf-8").trim();
    const hash = checksum(sqlText);

    const existing = await kdb
      .selectFrom("sentinel_schema_migrations")
      .select("checksum")
      .where("filename", "=", file)
      .limit(1)
      .executeTakeFirst();

    if (existing) {
      if (existing.checksum !== hash) {
        throw new Error(
          `[sqlite:migrate] Migration file changed after apply: ${file}. Create a new migration instead of editing applied ones.`,
        );
      }
      continue;
    }

    if (!sqlText) {
      throw new Error(`[sqlite:migrate] Migration file is empty: ${file}`);
    }

    console.log(`[sqlite:migrate] Applying ${file} ...`);

    try {
      db.exec("BEGIN");
      executeMigrationSql(db, sqlText);
      await kdb
        .insertInto("sentinel_schema_migrations")
        .values({ id: randomUUID(), filename: file, checksum: hash })
        .execute();
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Ignore rollback failures to preserve original error context.
      }
      throw error;
    }

    appliedCount++;
  }

  console.log(
    `[sqlite:migrate] Completed. Applied ${appliedCount} new migration(s).`,
  );
}

main().catch((error) => {
  console.error("[sqlite:migrate] Failed:", error);
  process.exit(1);
});
