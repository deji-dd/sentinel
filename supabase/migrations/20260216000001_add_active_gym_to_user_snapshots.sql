-- Add active_gym column to sentinel_user_snapshots
-- Stores the gym ID the user is currently training at

ALTER TABLE "public"."sentinel_user_snapshots" 
    ADD COLUMN IF NOT EXISTS "active_gym" INTEGER;

COMMENT ON COLUMN "public"."sentinel_user_snapshots"."active_gym" 
    IS 'The gym ID where the user is currently training (from /user gym selection)';
