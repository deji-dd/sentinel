-- Migration: Create Finance Module and Update Snapshots
--
-- This migration consolidates finance module setup:
-- 1. sentinel_user_snapshots: Historical snapshots of user financial and stat data
-- 2. sentinel_finance_settings: User preferences for financial management
-- 3. Add bookie_updated_at column to track Torn API networth cache timing

-- sentinel_user_snapshots: Store historical snapshots of user data
-- Primary key is auto-generated UUID to allow multiple snapshots over time
CREATE TABLE IF NOT EXISTS sentinel_user_snapshots (
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

-- Add bookie_updated_at if it doesn't exist
ALTER TABLE sentinel_user_snapshots ADD COLUMN IF NOT EXISTS bookie_updated_at TIMESTAMPTZ;

-- Create index on created_at for efficient time-based queries
CREATE INDEX IF NOT EXISTS idx_user_snapshots_created_at ON sentinel_user_snapshots(created_at DESC);

COMMENT ON TABLE sentinel_user_snapshots IS 'Historical snapshots of user financial and stat data for trend analysis';
COMMENT ON COLUMN sentinel_user_snapshots.bookie_updated_at IS 'Timestamp when bookie value was last updated from Torn API networth endpoint';

-- sent inel_finance_settings: User preferences for financial management
-- Use player_id as primary key (one row per user in personalized mode)
CREATE TABLE IF NOT EXISTS sentinel_finance_settings (
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

-- Enable RLS and create policies for unrestricted access
ALTER TABLE sentinel_user_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel_finance_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotent)
DO $$
BEGIN
  DROP POLICY IF EXISTS sentinel_user_snapshots_service_role ON sentinel_user_snapshots;
  DROP POLICY IF EXISTS sentinel_finance_settings_service_role ON sentinel_finance_settings;
  DROP POLICY IF EXISTS sentinel_user_snapshots_authenticated ON sentinel_user_snapshots;
  DROP POLICY IF EXISTS sentinel_finance_settings_authenticated ON sentinel_finance_settings;
END $$;

-- Service role access (for workers)
CREATE POLICY sentinel_user_snapshots_service_role ON sentinel_user_snapshots
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY sentinel_finance_settings_service_role ON sentinel_finance_settings
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Authenticated user access (for UI)
CREATE POLICY sentinel_user_snapshots_authenticated ON sentinel_user_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY sentinel_finance_settings_authenticated ON sentinel_finance_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
