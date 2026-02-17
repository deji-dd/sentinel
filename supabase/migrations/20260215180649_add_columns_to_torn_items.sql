-- Add new columns to sentinel_torn_items table for item effect tracking

ALTER TABLE "public"."sentinel_torn_items"
    ADD COLUMN IF NOT EXISTS "effect_text" TEXT,
    ADD COLUMN IF NOT EXISTS "energy_gain" INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "happy_gain" INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "cooldown_type" TEXT,
    ADD COLUMN IF NOT EXISTS "value" BIGINT;

-- Create index on energy_gain for efficient filtering
CREATE INDEX IF NOT EXISTS "idx_torn_items_energy_gain" 
    ON "public"."sentinel_torn_items" ("energy_gain") 
    WHERE "energy_gain" > 0;

-- Add comments for documentation
COMMENT ON COLUMN "public"."sentinel_torn_items"."effect_text" 
    IS 'Description of the item effect';
COMMENT ON COLUMN "public"."sentinel_torn_items"."energy_gain" 
    IS 'Energy gained when using this item';
COMMENT ON COLUMN "public"."sentinel_torn_items"."happy_gain" 
    IS 'Happiness gained when using this item';
COMMENT ON COLUMN "public"."sentinel_torn_items"."cooldown_type" 
    IS 'Type of cooldown associated with this item (e.g., crime, travel, etc.)';
COMMENT ON COLUMN "public"."sentinel_torn_items"."value" 
    IS 'Market or base value of the item';
