-- Add build preference information to training recommendations
-- Helps track if this stat is the user's main focus or not

ALTER TABLE "public"."sentinel_training_recommendations"
    ADD COLUMN IF NOT EXISTS "is_main_stat_focus" BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "priority_score" NUMERIC DEFAULT 0;

COMMENT ON COLUMN "public"."sentinel_training_recommendations"."is_main_stat_focus" 
    IS 'True if this stat is the user''s selected main stat from their build preference';
COMMENT ON COLUMN "public"."sentinel_training_recommendations"."priority_score" 
    IS 'Score used for ranking recommendations (lower is higher priority)';
