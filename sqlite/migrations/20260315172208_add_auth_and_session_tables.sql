-- Migration: add_auth_and_session_tables
-- Created (UTC): 2026-03-15T17:22:08.000Z

-- Note: Transaction management (BEGIN/COMMIT) is handled by the migration tool scripts.

-- Secure auth tokens for Magic Link activation
CREATE TABLE IF NOT EXISTS sentinel_auth_tokens (
    token TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    scope TEXT NOT NULL,          -- e.g. "map", "config", "all"
    target_path TEXT NOT NULL,    -- Deep link path e.g. "/selector"
    is_used INTEGER DEFAULT 0,    -- 1 if burned
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Web sessions created after token activation
-- This table is defined here with the new guild_id and target_path columns
CREATE TABLE IF NOT EXISTS sentinel_web_sessions (
    session_token TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,       -- Persistent guild context
    scope TEXT NOT NULL,          -- Access scope
    target_path TEXT,             -- Last or intended path
    device_id TEXT,               -- For optional device locking
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Revoked users list (blacklist)
CREATE TABLE IF NOT EXISTS sentinel_revoked_users (
    discord_id TEXT PRIMARY KEY,
    revoked_by TEXT NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON sentinel_auth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON sentinel_web_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_web_sessions_discord_id ON sentinel_web_sessions(discord_id);
