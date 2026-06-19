-- Migration: add_bazaar_mug_dashboard_message_id
-- Created (UTC): 2026-06-19T02:00:00.000Z

ALTER TABLE sentinel_bazaar_mug_config ADD COLUMN dashboard_message_id TEXT;
