-- Ensure all required columns exist on sentinel_user_snapshots
-- This handles cases where the table was created via remote schema before migrations

ALTER TABLE sentinel_user_snapshots
  ADD COLUMN IF NOT EXISTS bookie_value BIGINT,
  ADD COLUMN IF NOT EXISTS bookie_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS active_gym INTEGER,
  ADD COLUMN IF NOT EXISTS energy_current INTEGER,
  ADD COLUMN IF NOT EXISTS energy_maximum INTEGER,
  ADD COLUMN IF NOT EXISTS nerve_current INTEGER,
  ADD COLUMN IF NOT EXISTS nerve_maximum INTEGER,
  ADD COLUMN IF NOT EXISTS happy_current INTEGER,
  ADD COLUMN IF NOT EXISTS happy_maximum INTEGER,
  ADD COLUMN IF NOT EXISTS life_current INTEGER,
  ADD COLUMN IF NOT EXISTS life_maximum INTEGER,
  ADD COLUMN IF NOT EXISTS chain_current INTEGER,
  ADD COLUMN IF NOT EXISTS chain_maximum INTEGER,
  ADD COLUMN IF NOT EXISTS energy_flat_time_to_full BIGINT,
  ADD COLUMN IF NOT EXISTS nerve_flat_time_to_full BIGINT,
  ADD COLUMN IF NOT EXISTS happy_flat_time_to_full BIGINT,
  ADD COLUMN IF NOT EXISTS life_flat_time_to_full BIGINT,
  ADD COLUMN IF NOT EXISTS chain_flat_time_to_full BIGINT,
  ADD COLUMN IF NOT EXISTS strength_perk_gains NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS speed_perk_gains NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dexterity_perk_gains NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS defense_perk_gains NUMERIC DEFAULT 0;
