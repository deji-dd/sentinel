-- Migrate travel_settings.blacklisted_categories from text[] to integer[]
-- First, recreate the column with the new type
ALTER TABLE "public"."sentinel_travel_settings" 
DROP COLUMN "blacklisted_categories",
ADD COLUMN "blacklisted_categories" integer[] DEFAULT ARRAY[]::integer[];
