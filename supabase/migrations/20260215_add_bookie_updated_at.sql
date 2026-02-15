-- Migration: Add bookie_updated_at to user_snapshots
-- Tracks when the bookie value was last updated from Torn API

ALTER TABLE sentinel_user_snapshots ADD COLUMN IF NOT EXISTS bookie_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN sentinel_user_snapshots.bookie_updated_at IS 'Timestamp when bookie value was last updated from Torn API networth endpoint';
