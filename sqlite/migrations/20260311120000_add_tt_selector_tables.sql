-- Migration: Add TT Selector Tables
-- Description: Creates tables for storing custom territory configurations (TT Selector), territory paintings, labels, and session tokens.

-- Maps metadata
CREATE TABLE IF NOT EXISTS sentinel_maps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL, -- Discord ID
    guild_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Labels for a map (colors, names, and aggregated metadata targets)
CREATE TABLE IF NOT EXISTS sentinel_map_labels (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL,
    label_text TEXT NOT NULL,
    color_hex TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (map_id) REFERENCES sentinel_maps(id) ON DELETE CASCADE
);

-- Territory assignments within a map
CREATE TABLE IF NOT EXISTS sentinel_map_territories (
    map_id TEXT NOT NULL,
    territory_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (map_id, territory_id),
    FOREIGN KEY (map_id) REFERENCES sentinel_maps(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES sentinel_map_labels(id) ON DELETE CASCADE
);

-- Secure session tokens for web interface
CREATE TABLE IF NOT EXISTS sentinel_map_sessions (
    token TEXT PRIMARY KEY,
    map_id TEXT NOT NULL,
    user_id TEXT NOT NULL, -- Discord ID
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (map_id) REFERENCES sentinel_maps(id) ON DELETE CASCADE
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_map_labels_map_id ON sentinel_map_labels(map_id);
CREATE INDEX IF NOT EXISTS idx_map_territories_map_id ON sentinel_map_territories(map_id);
CREATE INDEX IF NOT EXISTS idx_map_sessions_expires_at ON sentinel_map_sessions(expires_at);
