-- Create table to store encrypted API keys per user
CREATE TABLE IF NOT EXISTS sentinel_user_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_encrypted TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT user_keys_unique_key UNIQUE(user_id, api_key_encrypted)
);

-- Create index for fast lookups by user
CREATE INDEX sentinel_user_keys_user_id_idx ON sentinel_user_keys(user_id) WHERE deleted_at IS NULL;
CREATE INDEX sentinel_user_keys_primary_idx ON sentinel_user_keys(user_id, is_primary) WHERE deleted_at IS NULL;

-- Enable RLS
ALTER TABLE sentinel_user_keys ENABLE ROW LEVEL SECURITY;

-- Service role can do anything
CREATE POLICY "sentinel_user_keys_service_role" ON sentinel_user_keys
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- Users can view their own keys
CREATE POLICY "sentinel_user_keys_select_self" ON sentinel_user_keys
  FOR SELECT USING (auth.uid() = user_id);

-- Users can delete their own keys
CREATE POLICY "sentinel_user_keys_delete_self" ON sentinel_user_keys
  FOR DELETE USING (auth.uid() = user_id);

---

-- Create mapping table for fast api_key_hash -> user_id lookups
CREATE TABLE IF NOT EXISTS sentinel_api_key_user_mapping (
  api_key_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Create index for efficiency
CREATE INDEX sentinel_api_key_user_mapping_user_id_idx ON sentinel_api_key_user_mapping(user_id) WHERE deleted_at IS NULL;

-- Enable RLS
ALTER TABLE sentinel_api_key_user_mapping ENABLE ROW LEVEL SECURITY;

-- Service role can do anything
CREATE POLICY "sentinel_api_key_user_mapping_service_role" ON sentinel_api_key_user_mapping
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

---

-- Migrate rate limit tracking to include user_id
-- First, add user_id column if it doesn't exist
ALTER TABLE sentinel_rate_limit_requests_per_user
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create new index for per-user rate limiting
CREATE INDEX IF NOT EXISTS sentinel_rate_limit_requests_user_id_idx
  ON sentinel_rate_limit_requests_per_user(user_id, requested_at DESC);

-- Keep old index for backward compatibility during migration
-- It will be dropped after migration is complete

---

-- Grant permissions
GRANT ALL ON sentinel_user_keys TO anon;
GRANT ALL ON sentinel_user_keys TO authenticated;
GRANT ALL ON sentinel_user_keys TO service_role;

GRANT ALL ON sentinel_api_key_user_mapping TO anon;
GRANT ALL ON sentinel_api_key_user_mapping TO authenticated;
GRANT ALL ON sentinel_api_key_user_mapping TO service_role;
