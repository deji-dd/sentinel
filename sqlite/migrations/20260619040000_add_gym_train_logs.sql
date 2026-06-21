-- Migration: add_gym_train_logs
-- Created (UTC): 2026-06-19T22:56:00.000Z

CREATE TABLE sentinel_gym_train_logs (
    log_id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    stat TEXT NOT NULL,
    gain REAL NOT NULL,
    energy INTEGER NOT NULL,
    happy INTEGER NOT NULL DEFAULT 0,
    gym_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_sentinel_gym_train_logs_timestamp ON sentinel_gym_train_logs (timestamp);
CREATE INDEX idx_sentinel_gym_train_logs_stat ON sentinel_gym_train_logs (stat);
