-- Migration to consolidate personal workers and cleanup tables/schedules

-- Create raw user logs table
CREATE TABLE IF NOT EXISTS sentinel_user_logs (
  log_id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sentinel_user_logs_timestamp ON sentinel_user_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_sentinel_user_logs_category ON sentinel_user_logs(category);

-- Truncate/delete user data from personal tables
DELETE FROM sentinel_user_snapshots;
DELETE FROM sentinel_battlestats_snapshots;
DELETE FROM sentinel_gym_train_logs;
DELETE FROM sentinel_financial_logs;
DELETE FROM sentinel_daily_finance_snapshots;
DELETE FROM sentinel_portfolio_snapshot;
DELETE FROM sentinel_stock_benefit_payouts;
DELETE FROM sentinel_user_crimes;

-- Delete schedules for the dangling/obsolete workers
DELETE FROM sentinel_worker_schedules WHERE worker_id IN (
  SELECT id FROM sentinel_workers WHERE name IN (
    'torn_gyms_worker',
    'battlestats_sync_worker',
    'battlestats_pruning_worker',
    'user_snapshot_worker',
    'user_snapshot_pruning_worker',
    'torn_crimes_worker',
    'torn_finance_logs_worker',
    'torn_portfolio_worker',
    'rate_limit_pruning_worker',
    'war_ledger_pruning_worker',
    'worker_logs_pruning_worker'
  )
);

DELETE FROM sentinel_workers WHERE name IN (
  'torn_gyms_worker',
  'battlestats_sync_worker',
  'battlestats_pruning_worker',
  'user_snapshot_worker',
  'user_snapshot_pruning_worker',
  'torn_crimes_worker',
  'torn_finance_logs_worker',
  'torn_portfolio_worker',
  'rate_limit_pruning_worker',
  'war_ledger_pruning_worker',
  'worker_logs_pruning_worker'
);
