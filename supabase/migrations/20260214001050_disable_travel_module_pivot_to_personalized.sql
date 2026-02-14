-- Migration: Disable travel module and pivot to personalized bot
-- 
-- This migration documents the hard pivot from a general multi-user bot to a
-- personalized single-user bot. The travel module is being put on the backburner
-- and all related workers and features are being disabled.
--
-- Changes:
-- 1. Disable all travel-related workers in sentinel_worker_schedules
-- 2. Mark travel tables as deprecated (data retained for restoration)
-- 3. Add comment documenting the migration and removal of multi-user infrastructure

-- Disable all travel module workers by marking them as disabled
UPDATE sentinel_worker_schedules 
SET enabled = false
WHERE worker_id IN (
  SELECT id FROM sentinel_workers 
  WHERE name LIKE 'travel_%' OR name LIKE '%travel%'
);

-- Add comments to travel tables documenting they are deprecated
COMMENT ON TABLE sentinel_travel_data IS 'DEPRECATED: Travel module disabled during hard pivot to personalized bot. Data retained for future restoration.';
COMMENT ON TABLE sentinel_travel_recommendations IS 'DEPRECATED: Travel module disabled during hard pivot to personalized bot. Data retained for future restoration.';
COMMENT ON TABLE sentinel_travel_stock_cache IS 'DEPRECATED: Travel module disabled during hard pivot to personalized bot. Data retained for future restoration.';
COMMENT ON TABLE sentinel_user_travel_settings IS 'DEPRECATED: Travel module disabled during hard pivot to personalized bot. Data retained for future restoration.';

-- Add comment to user_alerts table (used by travel module)
COMMENT ON TABLE sentinel_user_alerts IS 'Alert tracking table. Currently used by travel module (disabled). Data retained for future restoration.';
