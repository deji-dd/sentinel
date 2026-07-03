-- Migration: portfolio_module_upgrades
-- Created (UTC): 2026-07-03T20:20:35.049Z

-- Add company income locking columns to daily finance snapshots
ALTER TABLE sentinel_daily_finance_snapshots ADD COLUMN company_income INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sentinel_daily_finance_snapshots ADD COLUMN company_wages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sentinel_daily_finance_snapshots ADD COLUMN company_ad_budget INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sentinel_daily_finance_snapshots ADD COLUMN company_profit_locked INTEGER NOT NULL DEFAULT 0;

-- Create table to track accumulated benefit payouts
CREATE TABLE IF NOT EXISTS sentinel_stock_benefit_payouts (
  stock_id INTEGER NOT NULL,
  benefit_type TEXT NOT NULL, -- 'cash' | 'points' | 'stats' | 'items'
  quantity REAL NOT NULL DEFAULT 0,
  value_accumulated INTEGER NOT NULL DEFAULT 0,
  item_details TEXT NOT NULL DEFAULT '{}', -- JSON metadata mapping items to their historical prices and quantities
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (stock_id, benefit_type)
);

-- Create table to track processed logs to prevent double counting
CREATE TABLE IF NOT EXISTS sentinel_processed_benefit_logs (
  log_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Register the portfolio worker
INSERT OR IGNORE INTO sentinel_workers (id, name, created_at, updated_at)
VALUES (
  lower(hex(randomblob(16))),
  'torn_portfolio_worker',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
