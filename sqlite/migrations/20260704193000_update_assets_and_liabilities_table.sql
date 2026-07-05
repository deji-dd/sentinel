-- Recreate user assets to support average cost, is_loaned status, and unique IDs (UID)
DROP TABLE IF EXISTS sentinel_user_assets;

CREATE TABLE sentinel_user_assets (
  asset_type TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  average_cost REAL NOT NULL DEFAULT 0.0,
  is_loaned INTEGER NOT NULL DEFAULT 0,
  uid TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (asset_type, asset_key, is_loaned, uid)
);

-- Create table to track user liabilities (loans)
CREATE TABLE IF NOT EXISTS sentinel_user_liabilities (
  liability_id TEXT PRIMARY KEY,
  principal REAL NOT NULL,
  interest_rate REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
