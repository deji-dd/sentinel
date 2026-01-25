


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."sentinel_travel_data_update_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."sentinel_travel_data_update_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sentinel_user_travel_settings_update_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."sentinel_user_travel_settings_update_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sentinel_users_update_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."sentinel_users_update_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."store_user_key"("user_id" "uuid", "api_key" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Update or insert into a user_keys table
  -- Adjust table name and structure based on your schema
  INSERT INTO user_keys (user_id, api_key, created_at, updated_at)
  VALUES (user_id, api_key, NOW(), NOW())
  ON CONFLICT (user_id) DO UPDATE
  SET api_key = EXCLUDED.api_key, updated_at = NOW();
END;
$$;


ALTER FUNCTION "public"."store_user_key"("user_id" "uuid", "api_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_worker_schedules_update_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."user_worker_schedules_update_timestamp"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."sentinel_destination_travel_times" (
    "destination_id" integer NOT NULL,
    "standard" integer DEFAULT 0 NOT NULL,
    "airstrip" integer DEFAULT 0 NOT NULL,
    "wlt" integer DEFAULT 0 NOT NULL,
    "bct" integer DEFAULT 0 NOT NULL,
    "standard_w_book" integer DEFAULT 0 NOT NULL,
    "airstrip_w_book" integer DEFAULT 0 NOT NULL,
    "wlt_w_book" integer DEFAULT 0 NOT NULL,
    "bct_w_book" integer DEFAULT 0 NOT NULL,
    "standard_cost" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."sentinel_destination_travel_times" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_rate_limit_requests_per_user" (
    "id" bigint NOT NULL,
    "api_key_hash" "text" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_rate_limit_requests_per_user" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."sentinel_rate_limit_requests_per_user_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sentinel_rate_limit_requests_per_user_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sentinel_rate_limit_requests_per_user_id_seq" OWNED BY "public"."sentinel_rate_limit_requests_per_user"."id";



CREATE TABLE IF NOT EXISTS "public"."sentinel_torn_destinations" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "country_code" "text"
);


ALTER TABLE "public"."sentinel_torn_destinations" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."sentinel_torn_destinations_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sentinel_torn_destinations_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sentinel_torn_destinations_id_seq" OWNED BY "public"."sentinel_torn_destinations"."id";



CREATE TABLE IF NOT EXISTS "public"."sentinel_torn_items" (
    "item_id" integer NOT NULL,
    "name" "text" NOT NULL,
    "image" "text",
    "type" "text"
);


ALTER TABLE "public"."sentinel_torn_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_travel_data" (
    "user_id" "uuid" NOT NULL,
    "travel_destination" "text",
    "travel_method" "text",
    "travel_departed_at" timestamp with time zone,
    "travel_arrival_at" timestamp with time zone,
    "travel_time_left" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "capacity" integer DEFAULT 5,
    "has_airstrip" boolean DEFAULT false NOT NULL,
    "has_wlt_benefit" boolean DEFAULT false NOT NULL,
    "active_travel_book" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."sentinel_travel_data" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sentinel_travel_data"."capacity" IS 'User travel capacity from Torn API';



CREATE TABLE IF NOT EXISTS "public"."sentinel_travel_recommendations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "profit_per_trip" bigint,
    "profit_per_minute" numeric,
    "round_trip_minutes" integer,
    "recommendation_rank" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "destination_id" integer NOT NULL,
    "best_item_id" integer,
    "message" "text"
);


ALTER TABLE "public"."sentinel_travel_recommendations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_travel_stock_cache" (
    "id" bigint NOT NULL,
    "item_id" integer NOT NULL,
    "quantity" integer NOT NULL,
    "cost" bigint NOT NULL,
    "last_updated" timestamp with time zone DEFAULT "now"() NOT NULL,
    "destination_id" integer NOT NULL,
    "ingested_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_travel_stock_cache" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."sentinel_travel_stock_cache_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sentinel_travel_stock_cache_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sentinel_travel_stock_cache_id_seq" OWNED BY "public"."sentinel_travel_stock_cache"."id";



CREATE TABLE IF NOT EXISTS "public"."sentinel_user_bars" (
    "user_id" "uuid" NOT NULL,
    "energy_current" integer DEFAULT 0 NOT NULL,
    "energy_maximum" integer DEFAULT 0 NOT NULL,
    "nerve_current" integer DEFAULT 0 NOT NULL,
    "nerve_maximum" integer DEFAULT 0 NOT NULL,
    "happy_current" integer DEFAULT 0 NOT NULL,
    "happy_maximum" integer DEFAULT 0 NOT NULL,
    "life_current" integer DEFAULT 0 NOT NULL,
    "life_maximum" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "energy_flat_time_to_full" integer,
    "energy_time_to_full" integer,
    "nerve_flat_time_to_full" integer,
    "nerve_time_to_full" integer
);


ALTER TABLE "public"."sentinel_user_bars" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_user_cooldowns" (
    "user_id" "uuid" NOT NULL,
    "drug" integer DEFAULT 0 NOT NULL,
    "medical" integer DEFAULT 0 NOT NULL,
    "booster" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_user_cooldowns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_user_data" (
    "user_id" "uuid" NOT NULL,
    "player_id" integer NOT NULL,
    "name" "text",
    "is_donator" boolean DEFAULT false NOT NULL,
    "profile_image" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "discord_id" "text"
);


ALTER TABLE "public"."sentinel_user_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_user_travel_settings" (
    "user_id" "uuid" NOT NULL,
    "blacklisted_items" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "notification_threshold" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_user_travel_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_users" (
    "user_id" "uuid" NOT NULL,
    "api_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_worker_logs" (
    "id" bigint NOT NULL,
    "worker_id" "uuid" NOT NULL,
    "run_started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "run_finished_at" timestamp with time zone,
    "duration_ms" integer,
    "status" "text" NOT NULL,
    "message" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_limited" boolean DEFAULT false,
    "limited_until" timestamp with time zone,
    "last_error_at" timestamp with time zone,
    CONSTRAINT "sentinel_worker_logs_status_check" CHECK (("status" = ANY (ARRAY['success'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."sentinel_worker_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."sentinel_worker_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sentinel_worker_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sentinel_worker_logs_id_seq" OWNED BY "public"."sentinel_worker_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."sentinel_worker_schedules" (
    "worker_id" "uuid" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "force_run" boolean DEFAULT false NOT NULL,
    "cadence_seconds" integer NOT NULL,
    "next_run_at" timestamp with time zone NOT NULL,
    "last_run_at" timestamp with time zone,
    "attempts" integer DEFAULT 0 NOT NULL,
    "backoff_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sentinel_worker_schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_workers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_workers" OWNER TO "postgres";


ALTER TABLE ONLY "public"."sentinel_rate_limit_requests_per_user" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sentinel_rate_limit_requests_per_user_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sentinel_torn_destinations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sentinel_torn_destinations_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sentinel_travel_stock_cache" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sentinel_travel_stock_cache_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sentinel_worker_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sentinel_worker_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sentinel_destination_travel_times"
    ADD CONSTRAINT "sentinel_destination_travel_times_pkey" PRIMARY KEY ("destination_id");



ALTER TABLE ONLY "public"."sentinel_rate_limit_requests_per_user"
    ADD CONSTRAINT "sentinel_rate_limit_requests_per_user_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_torn_destinations"
    ADD CONSTRAINT "sentinel_torn_destinations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."sentinel_torn_destinations"
    ADD CONSTRAINT "sentinel_torn_destinations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_torn_items"
    ADD CONSTRAINT "sentinel_torn_items_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."sentinel_travel_data"
    ADD CONSTRAINT "sentinel_travel_data_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."sentinel_travel_recommendations"
    ADD CONSTRAINT "sentinel_travel_recommendations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_travel_stock_cache"
    ADD CONSTRAINT "sentinel_travel_stock_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_user_bars"
    ADD CONSTRAINT "sentinel_user_bars_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."sentinel_user_cooldowns"
    ADD CONSTRAINT "sentinel_user_cooldowns_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."sentinel_user_data"
    ADD CONSTRAINT "sentinel_user_data_discord_id_key" UNIQUE ("discord_id");



ALTER TABLE ONLY "public"."sentinel_user_data"
    ADD CONSTRAINT "sentinel_user_data_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."sentinel_user_travel_settings"
    ADD CONSTRAINT "sentinel_user_travel_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."sentinel_users"
    ADD CONSTRAINT "sentinel_users_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."sentinel_worker_logs"
    ADD CONSTRAINT "sentinel_worker_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_worker_schedules"
    ADD CONSTRAINT "sentinel_worker_schedules_pkey" PRIMARY KEY ("worker_id");



ALTER TABLE ONLY "public"."sentinel_workers"
    ADD CONSTRAINT "sentinel_workers_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."sentinel_workers"
    ADD CONSTRAINT "sentinel_workers_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_sentinel_worker_schedules_next_run" ON "public"."sentinel_worker_schedules" USING "btree" ("next_run_at");



CREATE INDEX "sentinel_rate_limit_requests_per_user_key_idx" ON "public"."sentinel_rate_limit_requests_per_user" USING "btree" ("api_key_hash", "requested_at" DESC);



CREATE UNIQUE INDEX "sentinel_torn_destinations_country_code_idx" ON "public"."sentinel_torn_destinations" USING "btree" ("country_code");



CREATE INDEX "sentinel_travel_recommendations_profit_per_minute_idx" ON "public"."sentinel_travel_recommendations" USING "btree" ("profit_per_minute" DESC);



CREATE INDEX "sentinel_travel_recommendations_rank_idx" ON "public"."sentinel_travel_recommendations" USING "btree" ("recommendation_rank");



CREATE UNIQUE INDEX "sentinel_travel_recommendations_user_destination_idx" ON "public"."sentinel_travel_recommendations" USING "btree" ("user_id", "destination_id");



CREATE INDEX "sentinel_travel_recommendations_user_id_idx" ON "public"."sentinel_travel_recommendations" USING "btree" ("user_id");



CREATE INDEX "sentinel_travel_stock_cache_item_id_idx" ON "public"."sentinel_travel_stock_cache" USING "btree" ("item_id");



CREATE INDEX "sentinel_travel_stock_cache_last_updated_idx" ON "public"."sentinel_travel_stock_cache" USING "btree" ("last_updated");



CREATE INDEX "sentinel_user_data_discord_id_idx" ON "public"."sentinel_user_data" USING "btree" ("discord_id") WHERE ("discord_id" IS NOT NULL);



CREATE INDEX "sentinel_user_data_player_id_idx" ON "public"."sentinel_user_data" USING "btree" ("player_id");



CREATE INDEX "sentinel_worker_logs_run_started_idx" ON "public"."sentinel_worker_logs" USING "btree" ("run_started_at");



CREATE INDEX "sentinel_worker_logs_worker_id_idx" ON "public"."sentinel_worker_logs" USING "btree" ("worker_id");



CREATE OR REPLACE TRIGGER "sentinel_travel_data_set_updated_at" BEFORE UPDATE ON "public"."sentinel_travel_data" FOR EACH ROW EXECUTE FUNCTION "public"."sentinel_travel_data_update_timestamp"();



CREATE OR REPLACE TRIGGER "sentinel_user_travel_settings_set_updated_at" BEFORE UPDATE ON "public"."sentinel_user_travel_settings" FOR EACH ROW EXECUTE FUNCTION "public"."sentinel_user_travel_settings_update_timestamp"();



CREATE OR REPLACE TRIGGER "sentinel_users_set_updated_at" BEFORE UPDATE ON "public"."sentinel_users" FOR EACH ROW EXECUTE FUNCTION "public"."sentinel_users_update_timestamp"();



ALTER TABLE ONLY "public"."sentinel_travel_recommendations"
    ADD CONSTRAINT "fk_best_item_id" FOREIGN KEY ("best_item_id") REFERENCES "public"."sentinel_torn_items"("item_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sentinel_destination_travel_times"
    ADD CONSTRAINT "sentinel_destination_travel_times_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "public"."sentinel_torn_destinations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_travel_data"
    ADD CONSTRAINT "sentinel_travel_data_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_travel_recommendations"
    ADD CONSTRAINT "sentinel_travel_recommendations_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "public"."sentinel_torn_destinations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_travel_recommendations"
    ADD CONSTRAINT "sentinel_travel_recommendations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_travel_stock_cache"
    ADD CONSTRAINT "sentinel_travel_stock_cache_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "public"."sentinel_torn_destinations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_travel_stock_cache"
    ADD CONSTRAINT "sentinel_travel_stock_cache_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."sentinel_torn_items"("item_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_user_bars"
    ADD CONSTRAINT "sentinel_user_bars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_user_cooldowns"
    ADD CONSTRAINT "sentinel_user_cooldowns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_user_data"
    ADD CONSTRAINT "sentinel_user_data_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_user_travel_settings"
    ADD CONSTRAINT "sentinel_user_travel_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_users"
    ADD CONSTRAINT "sentinel_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_worker_logs"
    ADD CONSTRAINT "sentinel_worker_logs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."sentinel_workers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_worker_schedules"
    ADD CONSTRAINT "sentinel_worker_schedules_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."sentinel_workers"("id") ON DELETE CASCADE;



ALTER TABLE "public"."sentinel_destination_travel_times" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_destination_travel_times_service_role" ON "public"."sentinel_destination_travel_times" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_rate_limit_requests_per_user" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_rate_limit_requests_per_user_service_role" ON "public"."sentinel_rate_limit_requests_per_user" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_torn_destinations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_torn_destinations_service_role" ON "public"."sentinel_torn_destinations" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_torn_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_torn_items_service_role" ON "public"."sentinel_torn_items" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_travel_data" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_travel_data_select_self" ON "public"."sentinel_travel_data" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "sentinel_travel_data_service_role" ON "public"."sentinel_travel_data" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_travel_recommendations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_travel_recommendations_select_self" ON "public"."sentinel_travel_recommendations" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "sentinel_travel_recommendations_service_role" ON "public"."sentinel_travel_recommendations" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_travel_stock_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_travel_stock_cache_service_role" ON "public"."sentinel_travel_stock_cache" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_user_bars" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_user_bars_select_self" ON "public"."sentinel_user_bars" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "sentinel_user_bars_service_role" ON "public"."sentinel_user_bars" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_user_cooldowns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_user_cooldowns_select_self" ON "public"."sentinel_user_cooldowns" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "sentinel_user_cooldowns_service_role" ON "public"."sentinel_user_cooldowns" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_user_data" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_user_data_select_self" ON "public"."sentinel_user_data" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "sentinel_user_data_service_role" ON "public"."sentinel_user_data" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_user_travel_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_user_travel_settings_insert_self" ON "public"."sentinel_user_travel_settings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "sentinel_user_travel_settings_select_self" ON "public"."sentinel_user_travel_settings" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "sentinel_user_travel_settings_update_self" ON "public"."sentinel_user_travel_settings" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."sentinel_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_users_select_self" ON "public"."sentinel_users" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "sentinel_users_update_self" ON "public"."sentinel_users" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."sentinel_worker_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_worker_logs_service_role" ON "public"."sentinel_worker_logs" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_worker_schedules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_worker_schedules_service_role" ON "public"."sentinel_worker_schedules" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_workers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_workers_service_role" ON "public"."sentinel_workers" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sentinel_users";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


































































































































































GRANT ALL ON FUNCTION "public"."sentinel_travel_data_update_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."sentinel_travel_data_update_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sentinel_travel_data_update_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sentinel_user_travel_settings_update_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."sentinel_user_travel_settings_update_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sentinel_user_travel_settings_update_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sentinel_users_update_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."sentinel_users_update_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sentinel_users_update_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."store_user_key"("user_id" "uuid", "api_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."store_user_key"("user_id" "uuid", "api_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."store_user_key"("user_id" "uuid", "api_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_worker_schedules_update_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."user_worker_schedules_update_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_worker_schedules_update_timestamp"() TO "service_role";



























GRANT ALL ON TABLE "public"."sentinel_destination_travel_times" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_destination_travel_times" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_destination_travel_times" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_rate_limit_requests_per_user" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_rate_limit_requests_per_user" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_rate_limit_requests_per_user" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sentinel_rate_limit_requests_per_user_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sentinel_rate_limit_requests_per_user_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sentinel_rate_limit_requests_per_user_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_torn_destinations" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_torn_destinations" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_torn_destinations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sentinel_torn_destinations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sentinel_torn_destinations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sentinel_torn_destinations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_torn_items" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_torn_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_torn_items" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_travel_data" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_travel_data" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_travel_data" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_travel_recommendations" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_travel_recommendations" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_travel_recommendations" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_travel_stock_cache" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_travel_stock_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_travel_stock_cache" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sentinel_travel_stock_cache_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sentinel_travel_stock_cache_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sentinel_travel_stock_cache_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_user_bars" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_user_bars" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_user_bars" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_user_cooldowns" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_user_cooldowns" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_user_cooldowns" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_user_data" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_user_data" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_user_data" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_user_travel_settings" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_user_travel_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_user_travel_settings" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_users" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_users" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_users" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_worker_logs" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_worker_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_worker_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sentinel_worker_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sentinel_worker_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sentinel_worker_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_worker_schedules" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_worker_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_worker_schedules" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_workers" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_workers" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_workers" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";


