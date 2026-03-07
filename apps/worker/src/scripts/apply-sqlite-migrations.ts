#!/usr/bin/env tsx
import { readdirSync, readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getDB } from "@sentinel/shared/db/sqlite.js";

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

function main(): void {
  const repoRoot = findRepoRoot();
  const migrationsDir = join(repoRoot, "sqlite", "migrations");
  const db = getDB();

  ensureMigrationsTable();

  const files = getMigrationFiles(migrationsDir);
  if (files.length === 0) {
    console.log("[sqlite:migrate] No migration files found.");
    return;
  }

  let appliedCount = 0;

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const sql = readFileSync(filePath, "utf-8").trim();
    const hash = checksum(sql);

    const existing = db
      .prepare(
        `SELECT checksum FROM sentinel_schema_migrations WHERE filename = ? LIMIT 1`,
      )
      .get(file) as { checksum: string } | undefined;

    if (existing) {
      if (existing.checksum !== hash) {
        throw new Error(
          `[sqlite:migrate] Migration file changed after apply: ${file}. Create a new migration instead of editing applied ones.`,
        );
      }
      continue;
    }

    if (!sql) {
      throw new Error(`[sqlite:migrate] Migration file is empty: ${file}`);
    }

    console.log(`[sqlite:migrate] Applying ${file} ...`);

    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        `INSERT INTO sentinel_schema_migrations (id, filename, checksum) VALUES (lower(hex(randomblob(16))), ?, ?)`,
      ).run(file, hash);
    });

    apply();
    appliedCount++;
  }

  console.log(`[sqlite:migrate] Completed. Applied ${appliedCount} new migration(s).`);
}

main();
