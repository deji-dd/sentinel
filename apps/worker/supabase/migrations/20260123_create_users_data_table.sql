-- Create sentinel_users_data table
CREATE TABLE IF NOT EXISTS sentinel_users_data (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  player_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  travel_capacity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on player_id for quick lookups
CREATE INDEX IF NOT EXISTS idx_sentinel_users_data_player_id ON sentinel_users_data(player_id);

-- Enable RLS
ALTER TABLE sentinel_users_data ENABLE ROW LEVEL SECURITY;

-- Create policy: users can read their own data
CREATE POLICY "Users can read their own data" ON sentinel_users_data
  FOR SELECT
  USING (auth.uid() = user_id);

-- Create policy: users can update their own data
CREATE POLICY "Users can update their own data" ON sentinel_users_data
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Add comment
COMMENT ON TABLE sentinel_users_data IS 'User profile data synced from Torn API';
COMMENT ON COLUMN sentinel_users_data.travel_capacity IS 'Total capacity for travel items';
