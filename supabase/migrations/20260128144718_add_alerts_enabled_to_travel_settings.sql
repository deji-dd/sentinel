-- Add alerts_enabled column to travel_settings (default true for existing users)
ALTER TABLE sentinel_travel_settings 
ADD COLUMN IF NOT EXISTS alerts_enabled boolean DEFAULT true NOT NULL;

-- Add comment for clarity
COMMENT ON COLUMN sentinel_travel_settings.alerts_enabled IS 'Whether user wants to receive Discord DM alerts for travel recommendations';
