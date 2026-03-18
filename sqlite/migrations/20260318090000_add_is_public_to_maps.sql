-- Migration: Add is_public to sentinel_maps
-- Description: Adds map visibility flag used by map listing and access checks.

ALTER TABLE sentinel_maps ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
