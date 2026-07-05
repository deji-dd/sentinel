-- Migration: create_daily_gym_summary

CREATE TABLE IF NOT EXISTS sentinel_daily_gym_summary (
  date TEXT PRIMARY KEY,
  strength_gain REAL NOT NULL DEFAULT 0.0,
  defense_gain REAL NOT NULL DEFAULT 0.0,
  speed_gain REAL NOT NULL DEFAULT 0.0,
  dexterity_gain REAL NOT NULL DEFAULT 0.0,
  energy_spent INTEGER NOT NULL DEFAULT 0,
  happy_spent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
