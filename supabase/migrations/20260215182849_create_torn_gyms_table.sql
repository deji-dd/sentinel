-- Create sentinel_torn_gyms table for gym data

CREATE TABLE IF NOT EXISTS "public"."sentinel_torn_gyms" (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  energy INTEGER NOT NULL,
  strength INTEGER NOT NULL,
  speed INTEGER NOT NULL,
  dexterity INTEGER NOT NULL,
  defense INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS "idx_torn_gyms_name" 
    ON "public"."sentinel_torn_gyms" ("name");

-- Add comment
COMMENT ON TABLE "public"."sentinel_torn_gyms" 
    IS 'Torn City gyms with stat bonuses for training';
COMMENT ON COLUMN "public"."sentinel_torn_gyms"."id" 
    IS 'Gym ID from Torn API';
COMMENT ON COLUMN "public"."sentinel_torn_gyms"."name" 
    IS 'Gym name';
COMMENT ON COLUMN "public"."sentinel_torn_gyms"."energy" 
    IS 'Energy bonus provided by this gym';
COMMENT ON COLUMN "public"."sentinel_torn_gyms"."strength" 
    IS 'Strength training bonus';
COMMENT ON COLUMN "public"."sentinel_torn_gyms"."speed" 
    IS 'Speed training bonus';
COMMENT ON COLUMN "public"."sentinel_torn_gyms"."dexterity" 
    IS 'Dexterity training bonus';
COMMENT ON COLUMN "public"."sentinel_torn_gyms"."defense" 
    IS 'Defense training bonus';
