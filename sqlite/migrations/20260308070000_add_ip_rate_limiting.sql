-- IP-based rate limiting for assist endpoints
-- Tracks failed requests and errors per IP to prevent abuse
CREATE TABLE IF NOT EXISTS sentinel_assist_ip_rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address TEXT NOT NULL,
  uuid TEXT,
  error_type TEXT NOT NULL,
  request_path TEXT,
  user_agent TEXT,
  request_count INTEGER NOT NULL DEFAULT 1,
  first_occurrence_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  last_occurrence_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  blocked_until TEXT
);

-- Index for efficient IP lookups
CREATE INDEX IF NOT EXISTS idx_assist_ip_rate_limits_ip_active
  ON sentinel_assist_ip_rate_limits (ip_address, is_blocked);

-- Index for blocked IP checks
CREATE INDEX IF NOT EXISTS idx_assist_ip_rate_limits_blocked
  ON sentinel_assist_ip_rate_limits (is_blocked, blocked_until);

-- Index for UUID tracking (for rate limiting per UUID)
CREATE INDEX IF NOT EXISTS idx_assist_ip_rate_limits_uuid
  ON sentinel_assist_ip_rate_limits (uuid);

-- Per-UUID rate limiting for successful script generation
CREATE TABLE IF NOT EXISTS sentinel_assist_script_generation_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_uuid TEXT NOT NULL UNIQUE,
  generation_count INTEGER NOT NULL DEFAULT 0,
  last_generation_at TEXT,
  last_generation_ip TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_failure_at TEXT,
  is_rate_limited INTEGER NOT NULL DEFAULT 0,
  rate_limit_until TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Index for checking rate limiters
CREATE INDEX IF NOT EXISTS idx_assist_script_generation_uuid
  ON sentinel_assist_script_generation_limits (token_uuid);

CREATE INDEX IF NOT EXISTS idx_assist_script_generation_rate_limited
  ON sentinel_assist_script_generation_limits (is_rate_limited, rate_limit_until);
