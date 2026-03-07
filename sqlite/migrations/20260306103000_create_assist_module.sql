-- Assist module configuration per guild
CREATE TABLE IF NOT EXISTS sentinel_assist_config (
  guild_id TEXT PRIMARY KEY,
  assist_channel_id TEXT,
  ping_role_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Authorized assist tokens used by external assist scripts
CREATE TABLE IF NOT EXISTS sentinel_assist_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  torn_id INTEGER NOT NULL,
  token_uuid TEXT NOT NULL UNIQUE,
  label TEXT,
  strike_count INTEGER NOT NULL DEFAULT 0 CHECK (strike_count >= 0),
  is_active INTEGER NOT NULL DEFAULT 1,
  blacklisted_at TEXT,
  blacklisted_reason TEXT,
  expires_at TEXT,
  last_used_at TEXT,
  last_seen_ip TEXT,
  last_seen_user_agent TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assist_tokens_guild_active
  ON sentinel_assist_tokens (guild_id, is_active);

CREATE INDEX IF NOT EXISTS idx_assist_tokens_discord
  ON sentinel_assist_tokens (discord_id);

CREATE INDEX IF NOT EXISTS idx_assist_tokens_torn
  ON sentinel_assist_tokens (torn_id);
