-- Create travel_settings table for user-specific travel preferences
CREATE TABLE IF NOT EXISTS "public"."sentinel_travel_settings" (
    "user_id" "uuid" NOT NULL,
    "last_alert_sent" timestamp with time zone,
    "alert_cooldown_minutes" integer DEFAULT 60 NOT NULL,
    "blacklisted_items" integer[] DEFAULT ARRAY[]::integer[],
    "blacklisted_categories" text[] DEFAULT ARRAY[]::text[],
    "min_profit_per_trip" bigint,
    "min_profit_per_minute" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."sentinel_travel_settings" OWNER TO "postgres";

-- Primary key
ALTER TABLE ONLY "public"."sentinel_travel_settings"
    ADD CONSTRAINT "sentinel_travel_settings_pkey" PRIMARY KEY ("user_id");

-- Foreign key to auth.users
ALTER TABLE ONLY "public"."sentinel_travel_settings"
    ADD CONSTRAINT "sentinel_travel_settings_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE "public"."sentinel_travel_settings" ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own settings
CREATE POLICY "sentinel_travel_settings_select_self" 
    ON "public"."sentinel_travel_settings" 
    FOR SELECT 
    USING (("auth"."uid"() = "user_id"));

-- Allow users to update their own settings
CREATE POLICY "sentinel_travel_settings_update_self" 
    ON "public"."sentinel_travel_settings" 
    FOR UPDATE 
    USING (("auth"."uid"() = "user_id"));

-- Allow users to insert their own settings
CREATE POLICY "sentinel_travel_settings_insert_self" 
    ON "public"."sentinel_travel_settings" 
    FOR INSERT 
    WITH CHECK (("auth"."uid"() = "user_id"));

-- Service role can do anything
CREATE POLICY "sentinel_travel_settings_service_role" 
    ON "public"."sentinel_travel_settings" 
    USING (("auth"."role"() = 'service_role'::"text")) 
    WITH CHECK (("auth"."role"() = 'service_role'::"text"));
