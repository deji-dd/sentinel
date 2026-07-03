-- Migration: add_financial_logs_table
-- Created (UTC): 2026-07-02T02:00:00.000Z

CREATE TABLE IF NOT EXISTS sentinel_financial_logs (
  log_id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  data TEXT NOT NULL, -- JSON string representation of the data payload
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
