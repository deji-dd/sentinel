-- Create training recommendations table
CREATE TABLE IF NOT EXISTS "public"."sentinel_training_recommendations" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    "best_method" TEXT NOT NULL,
    "cost_per_stat" NUMERIC NOT NULL,
    "recommended_qty" INTEGER NOT NULL,
    "details" JSONB
);

-- Create index on created_at for efficient time-based queries
CREATE INDEX "sentinel_training_recommendations_created_at_idx" 
    ON "public"."sentinel_training_recommendations" 
    USING BTREE ("created_at" DESC);

-- Add comment to describe the table
COMMENT ON TABLE "public"."sentinel_training_recommendations" 
    IS 'Training recommendations with cost per stat analysis and quantity suggestions';
