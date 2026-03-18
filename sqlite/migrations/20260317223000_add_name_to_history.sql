-- Migration: Add created_by_name to sentinel_map_history
-- Description: Adds a column to store the username of the person who created the history snapshot.

ALTER TABLE sentinel_map_history ADD COLUMN created_by_name TEXT;
