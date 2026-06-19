-- Migration: rename_min_bazaar_amount
-- Created (UTC): 2026-06-19T01:00:00.000Z

ALTER TABLE sentinel_bazaar_mug_config RENAME COLUMN min_bazaar_amount TO min_bazaar_drop_threshold;
