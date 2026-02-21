-- Merge sentinel_user_bars and sentinel_user_cooldowns into sentinel_user_snapshots
-- This consolidates all user state data into a single snapshot table for atomic historical tracking

-- Create sentinel_user_snapshots if it doesn't exist (will be used by finance module later)
CREATE TABLE IF NOT EXISTS sentinel_user_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add bars columns to sentinel_user_snapshots
ALTER TABLE sentinel_user_snapshots
  ADD COLUMN IF NOT EXISTS energy_current INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS energy_maximum INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nerve_current INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nerve_maximum INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS happy_current INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS happy_maximum INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS life_current INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS life_maximum INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chain_current INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chain_maximum INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS energy_flat_time_to_full INTEGER,
  ADD COLUMN IF NOT EXISTS energy_time_to_full INTEGER,
  ADD COLUMN IF NOT EXISTS nerve_flat_time_to_full INTEGER,
  ADD COLUMN IF NOT EXISTS nerve_time_to_full INTEGER;

-- Add cooldowns columns to sentinel_user_snapshots
ALTER TABLE sentinel_user_snapshots
  ADD COLUMN IF NOT EXISTS drug_cooldown INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS medical_cooldown INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS booster_cooldown INTEGER DEFAULT 0;

-- Drop the old tables since we're starting fresh (no data migration)
DROP TABLE IF EXISTS sentinel_user_bars CASCADE;
DROP TABLE IF EXISTS sentinel_user_cooldowns CASCADE;

COMMENT ON COLUMN sentinel_user_snapshots.energy_current IS 'Current energy (from bars)';
COMMENT ON COLUMN sentinel_user_snapshots.energy_maximum IS 'Maximum energy (from bars)';
COMMENT ON COLUMN sentinel_user_snapshots.nerve_current IS 'Current nerve (from bars)';
COMMENT ON COLUMN sentinel_user_snapshots.nerve_maximum IS 'Maximum nerve (from bars)';
COMMENT ON COLUMN sentinel_user_snapshots.happy_current IS 'Current happiness (from bars)';
COMMENT ON COLUMN sentinel_user_snapshots.happy_maximum IS 'Maximum happiness (from bars)';
COMMENT ON COLUMN sentinel_user_snapshots.life_current IS 'Current life (from bars)';
COMMENT ON COLUMN sentinel_user_snapshots.life_maximum IS 'Maximum life (from bars)';
COMMENT ON COLUMN sentinel_user_snapshots.chain_current IS 'Current chain count';
COMMENT ON COLUMN sentinel_user_snapshots.chain_maximum IS 'Maximum chain achieved';
COMMENT ON COLUMN sentinel_user_snapshots.drug_cooldown IS 'Drug cooldown remaining in seconds';
COMMENT ON COLUMN sentinel_user_snapshots.medical_cooldown IS 'Medical cooldown remaining in seconds';
COMMENT ON COLUMN sentinel_user_snapshots.booster_cooldown IS 'Booster cooldown remaining in seconds';
