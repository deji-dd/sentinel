-- Migration: Add Map History Table
-- Description: Creates a table to store snapshots of map configurations for versioning and rollback.

CREATE TABLE IF NOT EXISTS sentinel_map_history (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL, -- Full JSON blob of labels and territories
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL, -- Discord ID
    FOREIGN KEY (map_id) REFERENCES sentinel_maps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_map_history_map_id ON sentinel_map_history(map_id);
