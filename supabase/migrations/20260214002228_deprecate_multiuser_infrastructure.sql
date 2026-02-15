-- Migration: Deprecate multi-user infrastructure for personalized bot pivot
--
-- This migration documents the hard pivot from multi-user to personalized single-user
-- architecture. All tables, functions, and RLS policies remain for data integrity,
-- but are marked as DEPRECATED and should not be used for new features.
--
-- Breaking Changes:
-- - sentinel_users table is DEPRECATED (no longer populated)
-- - User authentication now handled via SENTINEL_USER_ID environment variable
-- - Worker and bot apps now use TORN_API_KEY directly from environment
-- - No per-user API key encryption/decryption needed

-- Mark sentinel_users table as deprecated
COMMENT ON TABLE sentinel_users IS 'DEPRECATED: Multi-user infrastructure removed in personalized bot pivot. Data retained for archival purposes only. All workers now use SENTINEL_USER_ID + TORN_API_KEY from environment.';

-- Mark user data tables as single-user
COMMENT ON TABLE sentinel_user_data IS 'Single-user data store for personalized bot mode. Contains data for user identified by SENTINEL_USER_ID environment variable.';
COMMENT ON TABLE sentinel_user_bars IS 'Single-user bars data (energy, nerve, happiness, life) for personalized bot mode.';
COMMENT ON TABLE sentinel_user_cooldowns IS 'Single-user cooldown tracking for personalized bot mode.';
COMMENT ON TABLE sentinel_user_travel_settings IS 'DEPRECATED: Travel module settings. Data retained for future restoration.';

-- Mark helper function as deprecated
COMMENT ON FUNCTION store_user_key IS 'DEPRECATED: Multi-user API key storage function. No longer used in personalized bot mode.';

-- Document the migration in sentinel_workers
INSERT INTO sentinel_workers (name, created_at, updated_at)
VALUES (
  'MIGRATION_20260214_PERSONALIZED_BOT_PIVOT',
  NOW(),
  NOW()
) ON CONFLICT (name) DO NOTHING;
