-- Create user build preferences table
-- Stores the user's selected stat build strategy and which stat to focus on
-- This influences the training recommendations worker to prioritize certain stats

CREATE TABLE IF NOT EXISTS "public"."sentinel_user_build_preferences" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "build_id" UUID NOT NULL REFERENCES "public"."sentinel_stat_builds"("id") ON DELETE RESTRICT,
    "main_stat" TEXT NOT NULL, -- 'strength', 'speed', 'dexterity', 'defense'
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT "user_build_preference_only_one" UNIQUE(id) -- Single user app = only one preference
);

-- Create index for efficient queries
CREATE INDEX "idx_user_build_preference_build_id" 
    ON "public"."sentinel_user_build_preferences" ("build_id");

-- Add comments for documentation
COMMENT ON TABLE "public"."sentinel_user_build_preferences" 
    IS 'User''s preferred stat build strategy and main stat focus for training recommendations';
COMMENT ON COLUMN "public"."sentinel_user_build_preferences"."main_stat" 
    IS 'The primary stat to focus on for this build (strength, speed, dexterity, defense)';
COMMENT ON COLUMN "public"."sentinel_user_build_preferences"."updated_at" 
    IS 'When the preference was last changed';
