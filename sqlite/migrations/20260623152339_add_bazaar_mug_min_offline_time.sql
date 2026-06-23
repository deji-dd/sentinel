-- Migration: add_bazaar_mug_min_offline_time
-- Created (UTC): 2026-06-23T15:23:39.120Z

ALTER TABLE sentinel_bazaar_mug_config ADD COLUMN min_offline_time_minutes INTEGER NOT NULL DEFAULT 0;


