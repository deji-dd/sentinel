-- Migration: daily_finance_snapshots
-- Created (UTC): 2026-07-03T00:52:12.000Z

CREATE TABLE IF NOT EXISTS sentinel_daily_finance_snapshots (
  date TEXT PRIMARY KEY,
  estimated_networth INTEGER NOT NULL,
  liquid_capital INTEGER NOT NULL,
  asset_valuation INTEGER NOT NULL,
  net_profit INTEGER NOT NULL,
  inflow INTEGER NOT NULL,
  outflow INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
