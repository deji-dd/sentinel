-- Create torn_categories table for normalized category management
CREATE TABLE IF NOT EXISTS "public"."sentinel_torn_categories" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT UNIQUE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."sentinel_torn_categories" OWNER TO "postgres";

-- Create index on name for faster lookups (skip if exists)
CREATE INDEX IF NOT EXISTS "sentinel_torn_categories_name_idx" ON "public"."sentinel_torn_categories" USING btree ("name");

-- Enable RLS
ALTER TABLE "public"."sentinel_torn_categories" ENABLE ROW LEVEL SECURITY;

-- Public read access (no auth needed for category list)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'sentinel_torn_categories' 
    AND policyname = 'sentinel_torn_categories_select_public'
  ) THEN
    CREATE POLICY "sentinel_torn_categories_select_public" 
      ON "public"."sentinel_torn_categories" 
      FOR SELECT 
      USING (true);
  END IF;
END $$;

-- Service role can manage
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'sentinel_torn_categories' 
    AND policyname = 'sentinel_torn_categories_service_role'
  ) THEN
    CREATE POLICY "sentinel_torn_categories_service_role" 
      ON "public"."sentinel_torn_categories" 
      USING (("auth"."role"() = 'service_role'::"text")) 
      WITH CHECK (("auth"."role"() = 'service_role'::"text"));
  END IF;
END $$;
