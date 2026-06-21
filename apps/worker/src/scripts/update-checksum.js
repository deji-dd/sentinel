import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const migrationsDir = path.join(repoRoot, "sqlite", "migrations");
const file = "20260308065837_convert_id_columns_to_text.sql";
const filePath = path.join(migrationsDir, file);

function checksum(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

const sqlText = fs.readFileSync(filePath, "utf-8").trim();
const hash = checksum(sqlText);

console.log("New Checksum:", hash);

const dbPath = path.join(repoRoot, "data", "sentinel-local.db");
console.log("DB Path:", dbPath);
const db = new Database(dbPath);
const stmt = db.prepare("UPDATE sentinel_schema_migrations SET checksum = ? WHERE filename = ?");
const info = stmt.run(hash, file);

console.log("Updated rows:", info.changes);
db.close();
