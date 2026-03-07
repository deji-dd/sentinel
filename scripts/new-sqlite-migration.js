#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function usage() {
  console.error("Usage: pnpm sqlite:new-migration <name>");
  process.exit(1);
}

const rawName = process.argv[2];
if (!rawName) {
  usage();
}

const safeName = rawName
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

if (!safeName) {
  usage();
}

const now = new Date();
const timestamp = [
  now.getUTCFullYear(),
  String(now.getUTCMonth() + 1).padStart(2, "0"),
  String(now.getUTCDate()).padStart(2, "0"),
  String(now.getUTCHours()).padStart(2, "0"),
  String(now.getUTCMinutes()).padStart(2, "0"),
  String(now.getUTCSeconds()).padStart(2, "0"),
].join("");

const fileName = `${timestamp}_${safeName}.sql`;
const migrationsDir = path.join(__dirname, "..", "sqlite", "migrations");
const filePath = path.join(migrationsDir, fileName);

if (!fs.existsSync(migrationsDir)) {
  fs.mkdirSync(migrationsDir, { recursive: true });
}

if (fs.existsSync(filePath)) {
  console.error(`Migration already exists: ${fileName}`);
  process.exit(1);
}

const content = `-- Migration: ${safeName}\n-- Created (UTC): ${new Date().toISOString()}\n\nBEGIN;\n\n-- Write your schema/data changes here\n\nCOMMIT;\n`;

fs.writeFileSync(filePath, content, "utf-8");
console.log(`Created migration: sqlite/migrations/${fileName}`);
