-- Migration: add_personal_stat_build_settings
-- Created (UTC): 2026-06-20T03:30:00.000Z

ALTER TABLE sentinel_personal_settings ADD COLUMN selected_build TEXT NOT NULL DEFAULT 'balanced';
ALTER TABLE sentinel_personal_settings ADD COLUMN target_strength_ratio REAL NOT NULL DEFAULT 25.0;
ALTER TABLE sentinel_personal_settings ADD COLUMN target_defense_ratio REAL NOT NULL DEFAULT 25.0;
ALTER TABLE sentinel_personal_settings ADD COLUMN target_speed_ratio REAL NOT NULL DEFAULT 25.0;
ALTER TABLE sentinel_personal_settings ADD COLUMN target_dexterity_ratio REAL NOT NULL DEFAULT 25.0;
