-- Add booster_cooldown_hours column to sentinel_torn_items
-- Represents how many hours the item adds to booster cooldown (if applicable)
-- e.g., cans add 2 hours, SE items add 6 hours

ALTER TABLE "public"."sentinel_torn_items"
    ADD COLUMN IF NOT EXISTS "booster_cooldown_hours" INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS "idx_torn_items_booster_cooldown" 
    ON "public"."sentinel_torn_items" ("booster_cooldown_hours") 
    WHERE "booster_cooldown_hours" > 0;

COMMENT ON COLUMN "public"."sentinel_torn_items"."booster_cooldown_hours" 
    IS 'Hours added to booster cooldown when using this item (extracted from effect field)';
