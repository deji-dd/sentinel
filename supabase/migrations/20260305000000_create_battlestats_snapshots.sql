-- Create battlestats snapshots table for stats module
-- Stores personal battlestats snapshots taken every minute

CREATE TABLE IF NOT EXISTS sentinel_battlestats_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  strength BIGINT NOT NULL,
  speed BIGINT NOT NULL,
  defense BIGINT NOT NULL,
  dexterity BIGINT NOT NULL,
  total_stats BIGINT NOT NULL
);

-- Create index on created_at for efficient time-based queries
CREATE INDEX IF NOT EXISTS idx_battlestats_snapshots_created_at ON sentinel_battlestats_snapshots(created_at DESC);

COMMENT ON TABLE sentinel_battlestats_snapshots IS 'Personal battlestats snapshots taken every minute for stats tracking';
COMMENT ON COLUMN sentinel_battlestats_snapshots.strength IS 'Strength battlestat value';
COMMENT ON COLUMN sentinel_battlestats_snapshots.speed IS 'Speed battlestat value';
COMMENT ON COLUMN sentinel_battlestats_snapshots.defense IS 'Defense battlestat value';
COMMENT ON COLUMN sentinel_battlestats_snapshots.dexterity IS 'Dexterity battlestat value';
COMMENT ON COLUMN sentinel_battlestats_snapshots.total_stats IS 'Sum of all battlestats (strength + speed + defense + dexterity)';

-- Enable RLS
ALTER TABLE sentinel_battlestats_snapshots ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotent)
DO $$
BEGIN
  DROP POLICY IF EXISTS sentinel_battlestats_snapshots_service_role ON sentinel_battlestats_snapshots;
  DROP POLICY IF EXISTS sentinel_battlestats_snapshots_authenticated ON sentinel_battlestats_snapshots;
END $$;

-- Service role access (for workers)
CREATE POLICY sentinel_battlestats_snapshots_service_role ON sentinel_battlestats_snapshots
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Authenticated user access (for UI)
CREATE POLICY sentinel_battlestats_snapshots_authenticated ON sentinel_battlestats_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
