-- Migration: financial_and_subcrimes
-- Created (UTC): 2026-07-01T23:10:00.000Z

-- Create stocks table
CREATE TABLE IF NOT EXISTS sentinel_torn_stocks (
  stock_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  acronym TEXT NOT NULL,
  logo_image TEXT,
  full_image TEXT,
  price REAL NOT NULL,
  market_cap INTEGER NOT NULL,
  shares INTEGER NOT NULL,
  investors INTEGER NOT NULL,
  bonus_passive INTEGER NOT NULL, -- 0 for false, 1 for true
  bonus_frequency INTEGER NOT NULL, -- in days
  bonus_requirement INTEGER NOT NULL, -- shares required
  bonus_description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Create subcrimes table
CREATE TABLE IF NOT EXISTS sentinel_torn_subcrimes (
  subcrime_id INTEGER PRIMARY KEY,
  crime_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  nerve_cost INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Create market prices table
CREATE TABLE IF NOT EXISTS sentinel_market_prices (
  key TEXT PRIMARY KEY,
  value REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Register the stocks worker
INSERT OR IGNORE INTO sentinel_workers (id, name, created_at, updated_at)
VALUES (
  lower(hex(randomblob(16))),
  'torn_stocks_worker',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
