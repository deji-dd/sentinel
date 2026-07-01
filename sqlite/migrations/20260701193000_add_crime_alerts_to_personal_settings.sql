-- Migration: add_crime_alerts_to_personal_settings
-- Created (UTC): 2026-07-01T19:30:00.000Z

ALTER TABLE sentinel_personal_settings ADD COLUMN crime_alerts_enabled INTEGER DEFAULT 0;
ALTER TABLE sentinel_personal_settings ADD COLUMN crime_soft_threshold INTEGER DEFAULT 15;
ALTER TABLE sentinel_personal_settings ADD COLUMN last_crime_alert_sent_at TEXT;
ALTER TABLE sentinel_personal_settings ADD COLUMN last_crime_alert_type TEXT;
