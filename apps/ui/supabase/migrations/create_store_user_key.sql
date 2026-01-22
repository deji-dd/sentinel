-- Supabase Migration: Create store_user_key RPC function
-- This function stores the Torn City API key for a user

CREATE OR REPLACE FUNCTION store_user_key(
  user_id UUID,
  api_key TEXT
)
RETURNS void AS $$
BEGIN
  -- Update or insert into a user_keys table
  -- Adjust table name and structure based on your schema
  INSERT INTO user_keys (user_id, api_key, created_at, updated_at)
  VALUES (user_id, api_key, NOW(), NOW())
  ON CONFLICT (user_id) DO UPDATE
  SET api_key = EXCLUDED.api_key, updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the user_keys table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Enable RLS for security
ALTER TABLE user_keys ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only read their own API key
CREATE POLICY "Users can view their own API key"
  ON user_keys
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can only update their own API key
CREATE POLICY "Users can update their own API key"
  ON user_keys
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can only insert their own API key
CREATE POLICY "Users can insert their own API key"
  ON user_keys
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
