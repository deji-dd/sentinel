-- Migration: portfolio_snapshot
-- Created (UTC): 2026-07-03T01:37:40.000Z

CREATE TABLE IF NOT EXISTS sentinel_portfolio_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
