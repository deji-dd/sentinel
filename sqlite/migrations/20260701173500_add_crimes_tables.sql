-- Migration: add_crimes_tables
-- Created (UTC): 2026-07-01T16:35:00.000Z

CREATE TABLE IF NOT EXISTS sentinel_torn_crimes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category_id INTEGER,
  category_name TEXT,
  enhancer_id INTEGER,
  enhancer_name TEXT,
  unique_outcomes_count INTEGER,
  unique_outcomes_ids TEXT, -- JSON stringified array of ids
  notes TEXT, -- JSON stringified array of strings
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sentinel_user_crimes (
  user_id INTEGER NOT NULL,
  crime_id INTEGER NOT NULL,
  nerve_spent INTEGER NOT NULL DEFAULT 0,
  skill REAL NOT NULL DEFAULT 0,
  progression_bonus INTEGER NOT NULL DEFAULT 0,
  attempts_total INTEGER NOT NULL DEFAULT 0,
  attempts_success INTEGER NOT NULL DEFAULT 0,
  attempts_fail INTEGER NOT NULL DEFAULT 0,
  attempts_critical_fail INTEGER NOT NULL DEFAULT 0,
  attempts_subcrimes TEXT, -- JSON stringified array
  rewards_money INTEGER NOT NULL DEFAULT 0,
  rewards_ammo_standard INTEGER NOT NULL DEFAULT 0,
  rewards_ammo_special INTEGER NOT NULL DEFAULT 0,
  rewards_items TEXT, -- JSON stringified array of { id, amount }
  uniques TEXT, -- JSON stringified array of uniques
  miscellaneous TEXT, -- JSON stringified miscellaneous
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, crime_id)
);

-- Register the worker
INSERT OR IGNORE INTO sentinel_workers (id, name, created_at, updated_at)
VALUES (
  lower(hex(randomblob(16))),
  'torn_crimes_worker',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
