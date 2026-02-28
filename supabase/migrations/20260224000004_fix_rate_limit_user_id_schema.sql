-- Fix rate limit table to use INTEGER user_id (Torn player IDs) matching api_key_user_mapping
-- Drop the old UUID-based index and foreign key
DROP INDEX IF EXISTS sentinel_rate_limit_requests_user_id_idx;

-- Clear existing rate limit records (ephemeral data, safe to drop)
TRUNCATE TABLE sentinel_rate_limit_requests_per_user;

-- Drop the UUID user_id column
ALTER TABLE sentinel_rate_limit_requests_per_user 
  DROP COLUMN user_id;

-- Add back user_id as INTEGER for Torn player IDs (matching api_key_user_mapping)
ALTER TABLE sentinel_rate_limit_requests_per_user 
  ADD COLUMN user_id INTEGER NOT NULL;

-- Recreate index for efficient per-user rate limiting
CREATE INDEX sentinel_rate_limit_requests_user_id_idx 
  ON sentinel_rate_limit_requests_per_user(user_id, requested_at DESC);
