-- Create torn_categories table for item category mapping
CREATE TABLE IF NOT EXISTS "public"."sentinel_torn_categories" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL UNIQUE,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."sentinel_torn_categories" OWNER TO "postgres";

-- Index for fast lookups
CREATE INDEX "sentinel_torn_categories_name_idx" ON "public"."sentinel_torn_categories" ("name");

-- Enable RLS
ALTER TABLE "public"."sentinel_torn_categories" ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read (public data)
CREATE POLICY "sentinel_torn_categories_select_all" 
    ON "public"."sentinel_torn_categories" 
    FOR SELECT 
    USING (true);

-- Allow service role to insert/update
CREATE POLICY "sentinel_torn_categories_service_role" 
    ON "public"."sentinel_torn_categories" 
    USING (("auth"."role"() = 'service_role'::"text")) 
    WITH CHECK (("auth"."role"() = 'service_role'::"text"));
