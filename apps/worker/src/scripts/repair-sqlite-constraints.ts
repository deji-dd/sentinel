#!/usr/bin/env tsx
/**
 * Rebuilds missing UNIQUE/PK semantics in SQLite as unique indexes.
 *
 * Why: the generated sqlite-schema can miss ALTER TABLE constraints from Postgres,
 * which breaks ON CONFLICT(...) in runtime queries.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { TABLE_NAMES } from "@sentinel/shared";
import { getDB } from "@sentinel/shared/db/sqlite.js";

type ParsedConstraint = {
  table: string;
  constraintName: string;
  columns: string[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function parseColumnList(input: string): string[] {
  return input
    .split(",")
    .map((part) => part.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function findRepoRootFromScript(): string {
  // apps/worker/src/scripts -> repo root is ../../../..
  return join(__dirname, "..", "..", "..", "..");
}

function parseUniqueAndPrimaryConstraints(
  schemaDump: string,
  allowedTables: Set<string>,
): ParsedConstraint[] {
  const constraints: ParsedConstraint[] = [];
  const regex =
    /ALTER TABLE ONLY\s+"public"\."([^"]+)"\s+ADD CONSTRAINT\s+"([^"]+)"\s+(PRIMARY KEY|UNIQUE)\s*\(([^\)]+)\);/gim;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(schemaDump)) !== null) {
    const table = match[1];
    const constraintName = match[2];
    const columnsRaw = match[4];

    if (!allowedTables.has(table)) {
      continue;
    }

    const columns = parseColumnList(columnsRaw);
    if (!columns.length) {
      continue;
    }

    constraints.push({ table, constraintName, columns });
  }

  return constraints;
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function buildIndexName(table: string, columns: string[]): string {
  return `uq_${table}_${columns.join("_")}`;
}

function buildDedupeSql(table: string, columns: string[]): string {
  const tableSql = quoteIdentifier(table);
  const groupBy = columns.map(quoteIdentifier).join(", ");

  // Keep the newest row (largest rowid) for each conflicting key tuple.
  return `DELETE FROM ${tableSql}
WHERE rowid NOT IN (
  SELECT MAX(rowid)
  FROM ${tableSql}
  GROUP BY ${groupBy}
);`;
}

function main(): void {
  const db = getDB();
  const repoRoot = findRepoRootFromScript();
  const schemaDumpPath = join(repoRoot, "supabase-schema-dump.sql");
  const schemaDump = readFileSync(schemaDumpPath, "utf-8");
  const allowedTables = new Set(unique(Object.values(TABLE_NAMES)));

  const parsed = parseUniqueAndPrimaryConstraints(schemaDump, allowedTables);

  console.log(
    `[sqlite:repair-constraints] Found ${parsed.length} PK/UNIQUE constraints for managed tables`,
  );

  let createdCount = 0;
  let errorCount = 0;
  let dedupeCount = 0;

  for (const item of parsed) {
    const indexName = buildIndexName(item.table, item.columns);
    const sql = `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${quoteIdentifier(item.table)} (${item.columns
      .map(quoteIdentifier)
      .join(", ")});`;

    try {
      db.exec(sql);
      createdCount++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("UNIQUE constraint failed")) {
        try {
          const dedupeSql = buildDedupeSql(item.table, item.columns);
          db.exec(dedupeSql);
          db.exec(sql);
          dedupeCount++;
          createdCount++;
          console.warn(
            `[sqlite:repair-constraints] Deduped and repaired: ${item.table} (${item.columns.join(", ")})`,
          );
          continue;
        } catch (retryError) {
          errorCount++;
          const retryMessage =
            retryError instanceof Error
              ? retryError.message
              : String(retryError);
          console.error(
            `[sqlite:repair-constraints] Failed after dedupe: ${item.table} (${item.columns.join(", ")}): ${retryMessage}`,
          );
          continue;
        }
      }

      errorCount++;
      console.error(
        `[sqlite:repair-constraints] Failed: ${item.table} (${item.columns.join(", ")}): ${message}`,
      );
    }
  }

  console.log(
    `[sqlite:repair-constraints] Completed. attempted=${parsed.length} applied=${createdCount} deduped=${dedupeCount} errors=${errorCount}`,
  );

  if (errorCount > 0) {
    process.exitCode = 1;
  }
}

main();
