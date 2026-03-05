-- Drop battlestats columns from sentinel_user_snapshots
-- These are now handled by the dedicated sentinel_battlestats_snapshots table

ALTER TABLE sentinel_user_snapshots
  DROP COLUMN IF EXISTS strength,
  DROP COLUMN IF EXISTS speed,
  DROP COLUMN IF EXISTS defense,
  DROP COLUMN IF EXISTS dexterity,
  DROP COLUMN IF EXISTS stats_total,
  DROP COLUMN IF EXISTS strength_perk_gains,
  DROP COLUMN IF EXISTS speed_perk_gains,
  DROP COLUMN IF EXISTS dexterity_perk_gains,
  DROP COLUMN IF EXISTS defense_perk_gains;
