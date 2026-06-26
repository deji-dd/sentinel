-- Migration: add_drug_alerts_to_personal_settings
-- Created (UTC): 2026-06-26T23:30:00.000Z

ALTER TABLE sentinel_personal_settings ADD COLUMN drug_alerts_enabled INTEGER DEFAULT 0;
ALTER TABLE sentinel_personal_settings ADD COLUMN last_drug_alert_sent_at TEXT;
