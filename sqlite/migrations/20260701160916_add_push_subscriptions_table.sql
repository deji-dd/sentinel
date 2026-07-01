-- Migration: add_push_subscriptions_table
-- Created (UTC): 2026-07-01T16:09:16.078Z

CREATE TABLE IF NOT EXISTS sentinel_push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  expiration_time INTEGER,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
