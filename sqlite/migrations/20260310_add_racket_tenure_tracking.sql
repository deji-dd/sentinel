-- Migration: add_racket_tenure_tracking
-- Created (UTC): 2026-03-10T00:00:00.000Z
-- Purpose: Track faction tenure of rackets to calculate accumulated rewards

CREATE TABLE IF NOT EXISTS sentinel_racket_tenure (
  id TEXT PRIMARY KEY,
  territory_id TEXT NOT NULL,
  faction_id INTEGER NOT NULL,
  racket_name TEXT NOT NULL,
  reward TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (territory_id) REFERENCES sentinel_territory_state(territory_id)
);

-- Index for efficient querying by faction + territory + active tenures
CREATE INDEX IF NOT EXISTS idx_racket_tenure_faction_active 
  ON sentinel_racket_tenure(faction_id, ended_at);

-- Index for querying active rackets on a territory
CREATE INDEX IF NOT EXISTS idx_racket_tenure_territory_active 
  ON sentinel_racket_tenure(territory_id, ended_at);
