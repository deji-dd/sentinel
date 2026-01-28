-- Create user_alerts table to track last alert sent per user per module
CREATE TABLE IF NOT EXISTS sentinel_user_alerts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module text NOT NULL, -- 'travel', 'crimes', 'faction', etc.
  last_alert_sent_at timestamp with time zone,
  last_alert_data jsonb, -- Store last recommendation data to avoid duplicate alerts
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, module)
);

-- Index for fast lookups by module
CREATE INDEX IF NOT EXISTS sentinel_user_alerts_module_idx ON sentinel_user_alerts(module);

-- Index for finding users eligible for alerts
CREATE INDEX IF NOT EXISTS sentinel_user_alerts_last_sent_idx ON sentinel_user_alerts(last_alert_sent_at);

-- RLS policies
ALTER TABLE sentinel_user_alerts ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'sentinel_user_alerts' 
    AND policyname = 'sentinel_user_alerts_service_role'
  ) THEN
    CREATE POLICY sentinel_user_alerts_service_role ON sentinel_user_alerts
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Grant permissions
GRANT ALL ON TABLE sentinel_user_alerts TO anon;
GRANT ALL ON TABLE sentinel_user_alerts TO authenticated;
GRANT ALL ON TABLE sentinel_user_alerts TO service_role;

-- Add comment
COMMENT ON TABLE sentinel_user_alerts IS 'Tracks last alert sent time per user per module to respect cooldowns';
