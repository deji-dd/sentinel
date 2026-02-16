-- Create Stat Builds Tables
-- Stores predefined stat build strategies (Hank's Ratio, Baldr's Ratio, etc.)
-- Each build has multiple configurations showing different stats as the main stat

CREATE TABLE IF NOT EXISTS "public"."sentinel_stat_builds" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL UNIQUE, -- e.g., "Hank's Ratio", "Baldr's Ratio"
    "slug" TEXT NOT NULL UNIQUE, -- e.g., "hanks-ratio", "baldrs-ratio"
    "description" TEXT, -- Explanation of the build philosophy
    "notes" TEXT, -- Additional notes about the build
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."sentinel_stat_build_configurations" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "build_id" UUID NOT NULL REFERENCES "public"."sentinel_stat_builds"("id") ON DELETE CASCADE,
    "main_stat" TEXT NOT NULL, -- 'strength', 'speed', 'dexterity', 'defense' (the highest/primary stat)
    "strength_value" BIGINT NOT NULL,
    "speed_value" BIGINT NOT NULL,
    "dexterity_value" BIGINT NOT NULL,
    "defense_value" BIGINT NOT NULL,
    "strength_percentage" NUMERIC(5, 2), -- e.g., 27.78, 34.72
    "speed_percentage" NUMERIC(5, 2),
    "dexterity_percentage" NUMERIC(5, 2),
    "defense_percentage" NUMERIC(5, 2),
    "notes" TEXT, -- Notes specific to this configuration
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE("build_id", "main_stat")
);

-- Create indexes for efficient queries
CREATE INDEX "idx_stat_builds_slug" ON "public"."sentinel_stat_builds" ("slug");
CREATE INDEX "idx_stat_build_configurations_build_id" ON "public"."sentinel_stat_build_configurations" ("build_id");
CREATE INDEX "idx_stat_build_configurations_main_stat" ON "public"."sentinel_stat_build_configurations" ("main_stat");

-- Add comments for documentation
COMMENT ON TABLE "public"."sentinel_stat_builds" 
    IS 'Predefined stat build strategies (ratios) for training and combat optimization';
COMMENT ON COLUMN "public"."sentinel_stat_builds"."slug" 
    IS 'URL-friendly identifier for the build (e.g., hanks-ratio)';
COMMENT ON COLUMN "public"."sentinel_stat_builds"."description" 
    IS 'Explanation of the build philosophy and how it works';

COMMENT ON TABLE "public"."sentinel_stat_build_configurations" 
    IS 'Specific configurations of each build with different stats as the main stat';
COMMENT ON COLUMN "public"."sentinel_stat_build_configurations"."main_stat" 
    IS 'The primary/highest stat in this configuration';
COMMENT ON COLUMN "public"."sentinel_stat_build_configurations"."strength_percentage" 
    IS 'Percentage of total stats represented by strength';
