-- Migration: Create Finance Module Tables
--
-- This migration creates tables for the Finance module:
-- 1. sentinel_user_snapshots: Historical snapshots of user financial and stat data
-- 2. sentinel_finance_settings: User preferences for financial management

-- sentinel_user_snapshots: Store historical snapshots of user data
-- Primary key is auto-generated UUID to allow multiple snapshots over time
CREATE TABLE sentinel_user_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  liquid_cash BIGINT,
  bookie_value BIGINT,
  net_worth BIGINT,
  stats_total BIGINT,
  strength BIGINT,
  speed BIGINT,
  defense BIGINT,
  dexterity BIGINT
);

-- Create index on created_at for efficient time-based queries
CREATE INDEX idx_user_snapshots_created_at ON sentinel_user_snapshots(created_at DESC);

COMMENT ON TABLE sentinel_user_snapshots IS 'Historical snapshots of user financial and stat data for trend analysis';

-- sentinel_finance_settings: User preferences for financial management
-- Use player_id as primary key (one row per user in personalized mode)
CREATE TABLE sentinel_finance_settings (
  player_id BIGINT PRIMARY KEY,
  min_reserve BIGINT DEFAULT 250000000 NOT NULL,
  split_bookie INTEGER DEFAULT 60 NOT NULL,
  split_training INTEGER DEFAULT 30 NOT NULL,
  split_gear INTEGER DEFAULT 10 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sentinel_finance_settings IS 'User preferences for financial management and budget splits';
COMMENT ON COLUMN sentinel_finance_settings.min_reserve IS 'Minimum cash reserve to maintain (default: $250M)';
COMMENT ON COLUMN sentinel_finance_settings.split_bookie IS 'Percentage of excess funds for bookie (default: 60%)';
COMMENT ON COLUMN sentinel_finance_settings.split_training IS 'Percentage of excess funds for training (default: 30%)';
COMMENT ON COLUMN sentinel_finance_settings.split_gear IS 'Percentage of excess funds for gear (default: 10%)';
