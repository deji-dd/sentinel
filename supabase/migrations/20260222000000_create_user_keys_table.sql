-- System API Keys table
-- Used for worker infrastructure syncing (personal data, items, gyms, TT data, etc.)
-- Worker can use these keys or system-provided keys
CREATE TABLE IF NOT EXISTS sentinel_system_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_encrypted TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  key_type TEXT DEFAULT 'personal' CHECK (key_type IN ('personal', 'system')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT system_api_keys_unique UNIQUE(user_id, api_key_encrypted)
);

-- Create indexes for fast lookups
CREATE INDEX sentinel_system_api_keys_user_id_idx ON sentinel_system_api_keys(user_id) WHERE deleted_at IS NULL;
CREATE INDEX sentinel_system_api_keys_primary_idx ON sentinel_system_api_keys(user_id, is_primary) WHERE deleted_at IS NULL;

-- Enable RLS - service role only
ALTER TABLE sentinel_system_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sentinel_system_api_keys_service_role" ON sentinel_system_api_keys
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

---

-- Guild API Keys table
-- Stores API keys provided by guild members for guild-specific operations
-- Fully isolated by guild (guild members can see/manage their guild's keys only)
CREATE TABLE IF NOT EXISTS sentinel_guild_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES sentinel_guild_config(guild_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_encrypted TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  provided_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT guild_api_keys_unique UNIQUE(guild_id, api_key_encrypted)
);

-- Create indexes for fast lookups
CREATE INDEX sentinel_guild_api_keys_guild_id_idx ON sentinel_guild_api_keys(guild_id) WHERE deleted_at IS NULL;
CREATE INDEX sentinel_guild_api_keys_user_id_idx ON sentinel_guild_api_keys(user_id) WHERE deleted_at IS NULL;
CREATE INDEX sentinel_guild_api_keys_primary_idx ON sentinel_guild_api_keys(guild_id, is_primary) WHERE deleted_at IS NULL;

-- Enable RLS
ALTER TABLE sentinel_guild_api_keys ENABLE ROW LEVEL SECURITY;

-- Service role can do anything
CREATE POLICY "sentinel_guild_api_keys_service_role" ON sentinel_guild_api_keys
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- Guild members can manage their guild's keys (read/write)
-- In practice, this should be further restricted to guild admins/leaders via app logic
CREATE POLICY "sentinel_guild_api_keys_guild_view" ON sentinel_guild_api_keys
  FOR SELECT USING (
    auth.role() = 'service_role'::text
    OR EXISTS (
      SELECT 1 FROM sentinel_faction_roles sfr
      WHERE sfr.guild_id = sentinel_guild_api_keys.guild_id
      AND sfr.discord_id = auth.uid()::text
    )
  );

CREATE POLICY "sentinel_guild_api_keys_guild_manage" ON sentinel_guild_api_keys
  FOR UPDATE USING (auth.role() = 'service_role'::text);

CREATE POLICY "sentinel_guild_api_keys_guild_delete" ON sentinel_guild_api_keys
  FOR DELETE USING (auth.role() = 'service_role'::text);

---

-- Core mapping table for rate limiting (system-level, service_role only)
-- Maps api_key_hash -> user_id so rate limiter knows who owns each key
-- Used across both system and guild keys
CREATE TABLE IF NOT EXISTS sentinel_api_key_user_mapping (
  api_key_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT CHECK (source IN ('system', 'guild')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Create index for efficiency
CREATE INDEX sentinel_api_key_user_mapping_user_id_idx ON sentinel_api_key_user_mapping(user_id) WHERE deleted_at IS NULL;

-- Enable RLS - service role only
ALTER TABLE sentinel_api_key_user_mapping ENABLE ROW LEVEL SECURITY;
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
GRANT ALL ON sentinel_system_api_keys TO anon;
GRANT ALL ON sentinel_system_api_keys TO authenticated;
GRANT ALL ON sentinel_system_api_keys TO service_role;

GRANT ALL ON sentinel_guild_api_keys TO anon;
GRANT ALL ON sentinel_guild_api_keys TO authenticated;
GRANT ALL ON sentinel_guild_api_keys TO service_role;

GRANT ALL ON sentinel_api_key_user_mapping TO anon;
GRANT ALL ON sentinel_api_key_user_mapping TO authenticated;
GRANT ALL ON sentinel_api_key_user_mapping TO service_role;
