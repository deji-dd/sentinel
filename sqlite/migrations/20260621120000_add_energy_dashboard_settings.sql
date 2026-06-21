-- Migration: add_energy_dashboard_settings
-- Created (UTC): 2026-06-21T22:15:00.000Z

ALTER TABLE sentinel_personal_settings ADD COLUMN energy_dashboard_rec_channel_id TEXT;
ALTER TABLE sentinel_personal_settings ADD COLUMN energy_dashboard_rec_message_id TEXT;
ALTER TABLE sentinel_personal_settings ADD COLUMN energy_dashboard_target_channel_id TEXT;
ALTER TABLE sentinel_personal_settings ADD COLUMN energy_dashboard_target_message_id TEXT;
ALTER TABLE sentinel_personal_settings ADD COLUMN energy_dashboard_graph_channel_id TEXT;
ALTER TABLE sentinel_personal_settings ADD COLUMN energy_dashboard_graph_message_id TEXT;
ALTER TABLE sentinel_personal_settings ADD COLUMN energy_dashboard_gains_channel_id TEXT;
ALTER TABLE sentinel_personal_settings ADD COLUMN energy_dashboard_gains_message_id TEXT;
ALTER TABLE sentinel_personal_settings ADD COLUMN energy_dashboard_gains_days INTEGER DEFAULT 1;
