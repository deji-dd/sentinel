-- Add perk gain columns to sentinel_user_snapshots
ALTER TABLE sentinel_user_snapshots
  ADD COLUMN IF NOT EXISTS strength_perk_gains NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS speed_perk_gains NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dexterity_perk_gains NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS defense_perk_gains NUMERIC DEFAULT 0;

COMMENT ON COLUMN sentinel_user_snapshots.strength_perk_gains IS 'Percentage gain to strength from gym perks (e.g., 15.0 for +15%)';
COMMENT ON COLUMN sentinel_user_snapshots.speed_perk_gains IS 'Percentage gain to speed from gym perks (e.g., 10.0 for +10%)';
COMMENT ON COLUMN sentinel_user_snapshots.dexterity_perk_gains IS 'Percentage gain to dexterity from gym perks (e.g., 12.0 for +12%)';
COMMENT ON COLUMN sentinel_user_snapshots.defense_perk_gains IS 'Percentage gain to defense from gym perks (e.g., 8.0 for +8%)';
