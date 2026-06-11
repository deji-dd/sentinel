-- Migration: Register mercenary population worker
-- Creates or ensures the mercenary_population worker is registered

-- Register the worker if it doesn't exist
INSERT OR IGNORE INTO sentinel_workers (id, name, created_at, updated_at)
VALUES (
  lower(hex(randomblob(16))),
  'mercenary_population',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
