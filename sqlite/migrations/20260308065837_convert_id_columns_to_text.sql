-- Migration: convert_id_columns_to_text
-- Created (UTC): 2026-03-08T06:58:37.092Z

-- Convert id columns from INTEGER to TEXT (UUID) in two tables:
-- 1. sentinel_rate_limit_requests_per_user
-- 2. sentinel_worker_logs
-- This migration preserves all existing data by converting integer ids to text.

PRAGMA foreign_keys = OFF;

-- =====================================================================
-- Table 1: sentinel_rate_limit_requests_per_user
-- =====================================================================

-- Create backup
DROP TABLE IF EXISTS sentinel_rate_limit_requests_per_user_backup;
CREATE TABLE sentinel_rate_limit_requests_per_user_backup AS 
  SELECT * FROM sentinel_rate_limit_requests_per_user;

-- Drop original table
DROP TABLE sentinel_rate_limit_requests_per_user;

-- Recreate with TEXT id
CREATE TABLE sentinel_rate_limit_requests_per_user (
  id TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user_id INTEGER
);

-- Recreate index
CREATE UNIQUE INDEX IF NOT EXISTS sentinel_rate_limit_requests_per_user_pkey 
  ON sentinel_rate_limit_requests_per_user (id);

-- Copy data back (convert INTEGER id to TEXT)
INSERT INTO sentinel_rate_limit_requests_per_user (id, api_key_hash, requested_at, user_id)
SELECT CAST(id AS TEXT), api_key_hash, requested_at, user_id
FROM sentinel_rate_limit_requests_per_user_backup;

-- Cleanup backup
DROP TABLE sentinel_rate_limit_requests_per_user_backup;

-- =====================================================================
-- Table 2: sentinel_worker_logs
-- =====================================================================

-- Create backup
DROP TABLE IF EXISTS sentinel_worker_logs_backup;
CREATE TABLE sentinel_worker_logs_backup AS 
  SELECT * FROM sentinel_worker_logs;

-- Drop original table
DROP TABLE sentinel_worker_logs;

-- Recreate with TEXT id
CREATE TABLE sentinel_worker_logs (
  id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  run_started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  run_finished_at TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  message TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  is_limited INTEGER DEFAULT 0,
  limited_until TEXT,
  last_error_at TEXT
);

-- Recreate index
CREATE UNIQUE INDEX IF NOT EXISTS sentinel_worker_logs_pkey 
  ON sentinel_worker_logs (id);

-- Copy data back (convert INTEGER id to TEXT)
INSERT INTO sentinel_worker_logs (
  id, worker_id, run_started_at, run_finished_at, duration_ms, 
  status, message, error_message, created_at, is_limited, 
  limited_until, last_error_at
)
SELECT 
  CAST(id AS TEXT), worker_id, run_started_at, run_finished_at, duration_ms,
  status, message, error_message, created_at, is_limited,
  limited_until, last_error_at
FROM sentinel_worker_logs_backup;

-- Cleanup backup
DROP TABLE sentinel_worker_logs_backup;

PRAGMA foreign_keys = ON;
