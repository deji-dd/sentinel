-- Alter travel_settings to use category IDs instead of category names
ALTER TABLE "public"."sentinel_travel_settings"
    ALTER COLUMN "blacklisted_categories" TYPE integer[] USING ARRAY[]::integer[];
