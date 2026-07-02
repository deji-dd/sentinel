-- Migration: add_user_assets_table
-- Created (UTC): 2026-07-01T23:38:00.000Z

CREATE TABLE IF NOT EXISTS sentinel_user_assets (
  asset_type TEXT NOT NULL, -- 'stock' or other future asset types
  asset_key TEXT NOT NULL, -- e.g. stock acronym or ID
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (asset_type, asset_key)
);
