-- Refactor training_recommendations table for single-user, booster-cooldown-aware recommendations
-- Removes columns not needed for single-user app: torn_player_id, best_method_name, exercises_affordable, better_gym_id
-- Adds column: max_quantity_affordable (replacing exercises_affordable with cost-based calculation)

-- Drop the old foreign key constraint if it exists
ALTER TABLE "public"."sentinel_training_recommendations" 
    DROP CONSTRAINT IF EXISTS "sentinel_training_recommendations_best_method_id_fkey";

-- Remove the torn_player_id index if it exists
DROP INDEX IF EXISTS "sentinel_training_recommendations_player_idx";

-- Drop columns that are no longer needed
ALTER TABLE "public"."sentinel_training_recommendations"
    DROP COLUMN IF EXISTS "torn_player_id",
    DROP COLUMN IF EXISTS "best_method_name",
    DROP COLUMN IF EXISTS "exercises_affordable",
    DROP COLUMN IF EXISTS "better_gym_id";

-- Add the new max_quantity_affordable column if it doesn't exist
ALTER TABLE "public"."sentinel_training_recommendations"
    ADD COLUMN IF NOT EXISTS "max_quantity_affordable" INTEGER NOT NULL DEFAULT 0;

-- Add best_method_id column if it doesn't exist (migration from best_method to best_method_id)
ALTER TABLE "public"."sentinel_training_recommendations"
    ADD COLUMN IF NOT EXISTS "best_method_id" INTEGER;

-- Add better_gym_name column if it doesn't exist
ALTER TABLE "public"."sentinel_training_recommendations"
    ADD COLUMN IF NOT EXISTS "better_gym_name" TEXT;

-- Add foreign key constraint to sentinel_torn_items
ALTER TABLE "public"."sentinel_training_recommendations" 
    ADD CONSTRAINT "sentinel_training_recommendations_best_method_id_fkey" 
    FOREIGN KEY ("best_method_id") REFERENCES "public"."sentinel_torn_items" ("item_id") ON DELETE RESTRICT;

-- Update comments to reflect changes
COMMENT ON TABLE "public"."sentinel_training_recommendations" 
    IS 'Per-stat training recommendations with cost analysis and gym optimization for single user';
COMMENT ON COLUMN "public"."sentinel_training_recommendations"."best_method_id" 
    IS 'Item ID of best training method (foreign key to sentinel_torn_items)';
COMMENT ON COLUMN "public"."sentinel_training_recommendations"."max_quantity_affordable" 
    IS 'Maximum number of items that can be purchased with training budget';
COMMENT ON COLUMN "public"."sentinel_training_recommendations"."better_gym_name" 
    IS 'Name of the better gym if current gym is sub-optimal (must be unlocked)';
