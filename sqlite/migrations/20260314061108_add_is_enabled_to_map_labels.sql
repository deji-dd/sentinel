-- Migration: Add is_enabled column to sentinel_map_labels
-- Description: Adds a boolean column to enable/disable labels in the Map Painter.

ALTER TABLE sentinel_map_labels ADD COLUMN is_enabled INTEGER DEFAULT 1;
