-- Rename columns in sentinel_torn_items table for consistency

-- Rename effect_text to effect
ALTER TABLE "public"."sentinel_torn_items"
    RENAME COLUMN "effect_text" TO "effect";

-- Rename cooldown_type to cooldown
ALTER TABLE "public"."sentinel_torn_items"
    RENAME COLUMN "cooldown_type" TO "cooldown";

-- Update comments
COMMENT ON COLUMN "public"."sentinel_torn_items"."effect" 
    IS 'Description of the item effect';
COMMENT ON COLUMN "public"."sentinel_torn_items"."cooldown" 
    IS 'Type of cooldown associated with this item (e.g., drug, booster, medical)';
