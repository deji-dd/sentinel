


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


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."sentinel_finalize_reaction_role_message"("p_record_id" bigint, "p_new_message_id" "text") RETURNS TABLE("updated_message_rows" integer, "updated_mapping_rows" integer)
    LANGUAGE "plpgsql"
    AS $$
declare
  v_old_message_id text;
  v_updated_message_rows integer := 0;
  v_updated_mapping_rows integer := 0;
begin
  set constraints fk_message_id deferred;

  select message_id
  into v_old_message_id
  from sentinel_reaction_role_messages
  where id = p_record_id
  for update;

  if v_old_message_id is null then
    raise exception 'Reaction role message record not found for id=%', p_record_id;
  end if;

  update sentinel_reaction_role_mappings
  set message_id = p_new_message_id
  where message_id = v_old_message_id;

  get diagnostics v_updated_mapping_rows = row_count;

  update sentinel_reaction_role_messages
  set message_id = p_new_message_id,
      updated_at = now()
  where id = p_record_id;

  get diagnostics v_updated_message_rows = row_count;

  return query
  select v_updated_message_rows, v_updated_mapping_rows;
end;
$$;


ALTER FUNCTION "public"."sentinel_finalize_reaction_role_message"("p_record_id" bigint, "p_new_message_id" "text") OWNER TO "postgres";


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


COMMENT ON FUNCTION "public"."store_user_key"("user_id" "uuid", "api_key" "text") IS 'DEPRECATED: Multi-user API key storage function. No longer used in personalized bot mode.';



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


CREATE TABLE IF NOT EXISTS "public"."sentinel_api_key_user_mapping" (
    "api_key_hash" "text" NOT NULL,
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "user_id" integer NOT NULL,
    CONSTRAINT "sentinel_api_key_user_mapping_source_check" CHECK (("source" = ANY (ARRAY['system'::"text", 'guild'::"text"])))
);


ALTER TABLE "public"."sentinel_api_key_user_mapping" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_assist_config" (
    "guild_id" "text" NOT NULL,
    "assist_channel_id" "text",
    "ping_role_id" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "script_generation_role_ids" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL
);


ALTER TABLE "public"."sentinel_assist_config" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sentinel_assist_config"."script_generation_role_ids" IS 'Role IDs that are allowed to generate assist script installation URLs';



CREATE TABLE IF NOT EXISTS "public"."sentinel_assist_tokens" (
    "id" bigint NOT NULL,
    "guild_id" "text" NOT NULL,
    "discord_id" "text" NOT NULL,
    "torn_id" integer NOT NULL,
    "token_uuid" "uuid" NOT NULL,
    "label" "text",
    "strike_count" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "blacklisted_at" timestamp with time zone,
    "blacklisted_reason" "text",
    "expires_at" timestamp with time zone,
    "last_used_at" timestamp with time zone,
    "last_seen_ip" "text",
    "last_seen_user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "assist_tokens_strike_count_check" CHECK (("strike_count" >= 0))
);


ALTER TABLE "public"."sentinel_assist_tokens" OWNER TO "postgres";


ALTER TABLE "public"."sentinel_assist_tokens" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."sentinel_assist_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sentinel_battlestats_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "strength" bigint NOT NULL,
    "speed" bigint NOT NULL,
    "defense" bigint NOT NULL,
    "dexterity" bigint NOT NULL,
    "total_stats" bigint NOT NULL
);


ALTER TABLE "public"."sentinel_battlestats_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_battlestats_snapshots" IS 'Personal battlestats snapshots taken every minute for stats tracking';



COMMENT ON COLUMN "public"."sentinel_battlestats_snapshots"."strength" IS 'Strength battlestat value';



COMMENT ON COLUMN "public"."sentinel_battlestats_snapshots"."speed" IS 'Speed battlestat value';



COMMENT ON COLUMN "public"."sentinel_battlestats_snapshots"."defense" IS 'Defense battlestat value';



COMMENT ON COLUMN "public"."sentinel_battlestats_snapshots"."dexterity" IS 'Dexterity battlestat value';



COMMENT ON COLUMN "public"."sentinel_battlestats_snapshots"."total_stats" IS 'Sum of all battlestats (strength + speed + defense + dexterity)';



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


CREATE TABLE IF NOT EXISTS "public"."sentinel_faction_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "guild_id" "text" NOT NULL,
    "faction_id" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "member_role_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "faction_name" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "leader_role_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL
);


ALTER TABLE "public"."sentinel_faction_roles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sentinel_faction_roles"."member_role_ids" IS 'Discord role IDs assigned to ALL members of this faction';



COMMENT ON COLUMN "public"."sentinel_faction_roles"."enabled" IS 'Whether this faction role mapping is active';



COMMENT ON COLUMN "public"."sentinel_faction_roles"."leader_role_ids" IS 'Discord role IDs assigned ONLY to faction leaders and co-leaders';



CREATE TABLE IF NOT EXISTS "public"."sentinel_finance_settings" (
    "player_id" bigint NOT NULL,
    "min_reserve" bigint DEFAULT 250000000 NOT NULL,
    "split_bookie" integer DEFAULT 60 NOT NULL,
    "split_training" integer DEFAULT 30 NOT NULL,
    "split_gear" integer DEFAULT 10 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_finance_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_finance_settings" IS 'User preferences for financial management and budget splits';



COMMENT ON COLUMN "public"."sentinel_finance_settings"."min_reserve" IS 'Minimum cash reserve to maintain (default: $250M)';



COMMENT ON COLUMN "public"."sentinel_finance_settings"."split_bookie" IS 'Percentage of excess funds for bookie (default: 60%)';



COMMENT ON COLUMN "public"."sentinel_finance_settings"."split_training" IS 'Percentage of excess funds for training (default: 30%)';



COMMENT ON COLUMN "public"."sentinel_finance_settings"."split_gear" IS 'Percentage of excess funds for gear (default: 10%)';



CREATE TABLE IF NOT EXISTS "public"."sentinel_guild_api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "guild_id" "text" NOT NULL,
    "api_key_encrypted" "text" NOT NULL,
    "is_primary" boolean DEFAULT false,
    "provided_by" "text" NOT NULL,
    "invalid_count" integer DEFAULT 0,
    "last_invalid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_used_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "user_id" integer NOT NULL
);


ALTER TABLE "public"."sentinel_guild_api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_guild_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "guild_id" "text" NOT NULL,
    "actor_discord_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_guild_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_guild_config" (
    "guild_id" "text" NOT NULL,
    "enabled_modules" "text"[] DEFAULT '{}'::"text"[],
    "admin_role_ids" "text"[] DEFAULT '{}'::"text"[],
    "verified_role_ids" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "nickname_template" "text" DEFAULT '{name}#{id}'::"text",
    "auto_verify" boolean DEFAULT false,
    "sync_interval_seconds" integer DEFAULT 3600,
    "verified_role_id" "text",
    "log_channel_id" "text",
    "tt_full_channel_id" "text",
    "tt_filtered_channel_id" "text",
    "tt_territory_ids" "text"[] DEFAULT '{}'::"text"[],
    "tt_faction_ids" integer[] DEFAULT '{}'::integer[]
);


ALTER TABLE "public"."sentinel_guild_config" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sentinel_guild_config"."verified_role_id" IS 'Role assigned to all verified members (before faction-specific roles)';



COMMENT ON COLUMN "public"."sentinel_guild_config"."log_channel_id" IS 'Discord channel ID for logging automatic bot actions and errors. If set, bot will send logs to this channel.';



CREATE TABLE IF NOT EXISTS "public"."sentinel_guild_sync_jobs" (
    "guild_id" "text" NOT NULL,
    "last_sync_at" timestamp with time zone,
    "next_sync_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "in_progress" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sentinel_guild_sync_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_rate_limit_requests_per_user" (
    "id" bigint NOT NULL,
    "api_key_hash" "text" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" integer NOT NULL
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



CREATE TABLE IF NOT EXISTS "public"."sentinel_reaction_role_config" (
    "guild_id" "text" NOT NULL,
    "allowed_role_ids" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sentinel_reaction_role_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_reaction_role_mappings" (
    "id" bigint NOT NULL,
    "message_id" "text" NOT NULL,
    "emoji" "text" NOT NULL,
    "role_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sentinel_reaction_role_mappings" OWNER TO "postgres";


ALTER TABLE "public"."sentinel_reaction_role_mappings" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."sentinel_reaction_role_mappings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sentinel_reaction_role_messages" (
    "id" bigint NOT NULL,
    "guild_id" "text" NOT NULL,
    "channel_id" "text" NOT NULL,
    "message_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sentinel_reaction_role_messages" OWNER TO "postgres";


ALTER TABLE "public"."sentinel_reaction_role_messages" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."sentinel_reaction_role_messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sentinel_revive_config" (
    "guild_id" "text" NOT NULL,
    "request_channel_id" "text",
    "requests_output_channel_id" "text",
    "min_hospital_seconds_left" integer DEFAULT 0 NOT NULL,
    "request_message_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ping_role_id" "text"
);


ALTER TABLE "public"."sentinel_revive_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_revive_requests" (
    "id" bigint NOT NULL,
    "guild_id" "text" NOT NULL,
    "requester_discord_id" "text" NOT NULL,
    "request_channel_id" "text",
    "request_message_id" "text",
    "requester_torn_id" integer,
    "requester_torn_name" "text",
    "revivable" boolean,
    "status_description" "text",
    "status_details" "text",
    "status_state" "text",
    "hospital_until" integer,
    "hospital_seconds_left" integer,
    "faction_id" integer,
    "last_action_status" "text",
    "last_action_relative" "text",
    "last_action_timestamp" integer,
    "state" "text" DEFAULT 'active'::"text" NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:05:00'::interval) NOT NULL,
    "completed_by_discord_id" "text",
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "revive_request_state_check" CHECK (("state" = ANY (ARRAY['active'::"text", 'completed'::"text", 'cancelled'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."sentinel_revive_requests" OWNER TO "postgres";


ALTER TABLE "public"."sentinel_revive_requests" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."sentinel_revive_requests_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sentinel_stat_build_configurations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "build_id" "uuid" NOT NULL,
    "main_stat" "text" NOT NULL,
    "strength_value" bigint NOT NULL,
    "speed_value" bigint NOT NULL,
    "dexterity_value" bigint NOT NULL,
    "defense_value" bigint NOT NULL,
    "strength_percentage" numeric(5,2),
    "speed_percentage" numeric(5,2),
    "dexterity_percentage" numeric(5,2),
    "defense_percentage" numeric(5,2),
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_stat_build_configurations" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_stat_build_configurations" IS 'Specific configurations of each build with different stats as the main stat';



COMMENT ON COLUMN "public"."sentinel_stat_build_configurations"."main_stat" IS 'The primary/highest stat in this configuration';



COMMENT ON COLUMN "public"."sentinel_stat_build_configurations"."strength_percentage" IS 'Percentage of total stats represented by strength';



CREATE TABLE IF NOT EXISTS "public"."sentinel_stat_builds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_stat_builds" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_stat_builds" IS 'Predefined stat build strategies (ratios) for training and combat optimization';



COMMENT ON COLUMN "public"."sentinel_stat_builds"."slug" IS 'URL-friendly identifier for the build (e.g., hanks-ratio)';



COMMENT ON COLUMN "public"."sentinel_stat_builds"."description" IS 'Explanation of the build philosophy and how it works';



CREATE TABLE IF NOT EXISTS "public"."sentinel_system_api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "api_key_encrypted" "text" NOT NULL,
    "is_primary" boolean DEFAULT false,
    "key_type" "text" DEFAULT 'personal'::"text",
    "invalid_count" integer DEFAULT 0,
    "last_invalid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_used_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "user_id" integer NOT NULL,
    "api_key_hash" "text",
    CONSTRAINT "sentinel_system_api_keys_key_type_check" CHECK (("key_type" = ANY (ARRAY['personal'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."sentinel_system_api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_territory_blueprint" (
    "id" "text" NOT NULL,
    "sector" integer NOT NULL,
    "size" integer NOT NULL,
    "density" integer NOT NULL,
    "slots" integer NOT NULL,
    "respect" integer NOT NULL,
    "coordinate_x" double precision NOT NULL,
    "coordinate_y" double precision NOT NULL,
    "neighbors" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sentinel_territory_blueprint" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_territory_state" (
    "territory_id" "text" NOT NULL,
    "faction_id" integer,
    "is_warring" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "racket_name" "text",
    "racket_level" integer,
    "racket_reward" "text",
    "racket_created_at" integer,
    "racket_changed_at" integer
);


ALTER TABLE "public"."sentinel_territory_state" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sentinel_territory_state"."racket_name" IS 'Name of racket currently on this territory (e.g., "Bootleg Distillery V")';



COMMENT ON COLUMN "public"."sentinel_territory_state"."racket_level" IS 'Level of racket (1-5)';



COMMENT ON COLUMN "public"."sentinel_territory_state"."racket_reward" IS 'Description of daily reward from racket';



COMMENT ON COLUMN "public"."sentinel_territory_state"."racket_created_at" IS 'Unix timestamp when racket was first created on this territory';



COMMENT ON COLUMN "public"."sentinel_territory_state"."racket_changed_at" IS 'Unix timestamp when racket was last modified (level change)';



CREATE TABLE IF NOT EXISTS "public"."sentinel_torn_categories" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_torn_categories" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."sentinel_torn_categories_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sentinel_torn_categories_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sentinel_torn_categories_id_seq" OWNED BY "public"."sentinel_torn_categories"."id";



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



CREATE TABLE IF NOT EXISTS "public"."sentinel_torn_factions" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "tag" "text" NOT NULL,
    "tag_image" "text",
    "leader_id" integer,
    "co_leader_id" integer,
    "respect" integer NOT NULL,
    "days_old" integer,
    "capacity" integer NOT NULL,
    "members" integer NOT NULL,
    "is_enlisted" boolean,
    "rank" "text",
    "best_chain" integer,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sentinel_torn_factions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_torn_gyms" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "energy" integer NOT NULL,
    "strength" integer NOT NULL,
    "speed" integer NOT NULL,
    "dexterity" integer NOT NULL,
    "defense" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "unlocked" boolean DEFAULT false
);


ALTER TABLE "public"."sentinel_torn_gyms" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_torn_gyms" IS 'Torn City gyms with stat bonuses for training';



COMMENT ON COLUMN "public"."sentinel_torn_gyms"."id" IS 'Gym ID from Torn API';



COMMENT ON COLUMN "public"."sentinel_torn_gyms"."name" IS 'Gym name';



COMMENT ON COLUMN "public"."sentinel_torn_gyms"."energy" IS 'Energy bonus provided by this gym';



COMMENT ON COLUMN "public"."sentinel_torn_gyms"."strength" IS 'Strength training bonus';



COMMENT ON COLUMN "public"."sentinel_torn_gyms"."speed" IS 'Speed training bonus';



COMMENT ON COLUMN "public"."sentinel_torn_gyms"."dexterity" IS 'Dexterity training bonus';



COMMENT ON COLUMN "public"."sentinel_torn_gyms"."defense" IS 'Defense training bonus';



CREATE TABLE IF NOT EXISTS "public"."sentinel_torn_items" (
    "item_id" integer NOT NULL,
    "name" "text" NOT NULL,
    "image" "text",
    "type" "text",
    "category_id" integer,
    "effect" "text",
    "energy_gain" integer DEFAULT 0,
    "happy_gain" integer DEFAULT 0,
    "cooldown" "text",
    "value" bigint,
    "booster_cooldown_hours" integer DEFAULT 0
);


ALTER TABLE "public"."sentinel_torn_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sentinel_torn_items"."effect" IS 'Description of the item effect';



COMMENT ON COLUMN "public"."sentinel_torn_items"."energy_gain" IS 'Energy gained when using this item';



COMMENT ON COLUMN "public"."sentinel_torn_items"."happy_gain" IS 'Happiness gained when using this item';



COMMENT ON COLUMN "public"."sentinel_torn_items"."cooldown" IS 'Type of cooldown associated with this item (e.g., drug, booster, medical)';



COMMENT ON COLUMN "public"."sentinel_torn_items"."value" IS 'Market or base value of the item';



COMMENT ON COLUMN "public"."sentinel_torn_items"."booster_cooldown_hours" IS 'Hours added to booster cooldown when using this item (extracted from effect field)';



CREATE TABLE IF NOT EXISTS "public"."sentinel_training_recommendations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "best_method" "text" NOT NULL,
    "cost_per_stat" numeric NOT NULL,
    "recommended_qty" integer NOT NULL,
    "details" "jsonb",
    "max_quantity_affordable" integer DEFAULT 0 NOT NULL,
    "best_method_id" integer,
    "better_gym_name" "text",
    "is_main_stat_focus" boolean DEFAULT false,
    "priority_score" numeric DEFAULT 0
);


ALTER TABLE "public"."sentinel_training_recommendations" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_training_recommendations" IS 'Per-stat training recommendations with cost analysis and gym optimization for single user';



COMMENT ON COLUMN "public"."sentinel_training_recommendations"."max_quantity_affordable" IS 'Maximum number of items that can be purchased with training budget';



COMMENT ON COLUMN "public"."sentinel_training_recommendations"."best_method_id" IS 'Item ID of best training method (foreign key to sentinel_torn_items)';



COMMENT ON COLUMN "public"."sentinel_training_recommendations"."better_gym_name" IS 'Name of the better gym if current gym is sub-optimal (must be unlocked)';



COMMENT ON COLUMN "public"."sentinel_training_recommendations"."is_main_stat_focus" IS 'True if this stat is the user''s selected main stat from their build preference';



COMMENT ON COLUMN "public"."sentinel_training_recommendations"."priority_score" IS 'Score used for ranking recommendations (lower is higher priority)';



CREATE TABLE IF NOT EXISTS "public"."sentinel_travel_data" (
    "travel_destination" "text",
    "travel_method" "text",
    "travel_departed_at" timestamp with time zone,
    "travel_arrival_at" timestamp with time zone,
    "travel_time_left" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "capacity" integer DEFAULT 5,
    "has_airstrip" boolean DEFAULT false NOT NULL,
    "has_wlt_benefit" boolean DEFAULT false NOT NULL,
    "active_travel_book" boolean DEFAULT false NOT NULL,
    "player_id" bigint NOT NULL
);


ALTER TABLE "public"."sentinel_travel_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_travel_data" IS 'Single Torn user travel state. Keyed by player_id.';



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
    "message" "text",
    "cash_to_carry" bigint
);


ALTER TABLE "public"."sentinel_travel_recommendations" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_travel_recommendations" IS 'Travel recommendations per destination. Single user in personalized mode.';



CREATE TABLE IF NOT EXISTS "public"."sentinel_travel_settings" (
    "user_id" "uuid" NOT NULL,
    "last_alert_sent" timestamp with time zone,
    "alert_cooldown_minutes" integer DEFAULT 60 NOT NULL,
    "blacklisted_items" integer[] DEFAULT ARRAY[]::integer[],
    "min_profit_per_trip" bigint,
    "min_profit_per_minute" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "blacklisted_categories" integer[] DEFAULT ARRAY[]::integer[],
    "alerts_enabled" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."sentinel_travel_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sentinel_travel_settings"."alerts_enabled" IS 'Whether user wants to receive Discord DM alerts for travel recommendations';



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


COMMENT ON TABLE "public"."sentinel_travel_stock_cache" IS 'DEPRECATED: Travel module disabled during hard pivot to personalized bot. Data retained for future restoration.';



CREATE SEQUENCE IF NOT EXISTS "public"."sentinel_travel_stock_cache_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sentinel_travel_stock_cache_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sentinel_travel_stock_cache_id_seq" OWNED BY "public"."sentinel_travel_stock_cache"."id";



CREATE TABLE IF NOT EXISTS "public"."sentinel_tt_config" (
    "guild_id" "text" NOT NULL,
    "notification_type" "text" DEFAULT 'all'::"text" NOT NULL,
    "territory_ids" "text"[] DEFAULT '{}'::"text"[],
    "faction_ids" integer[] DEFAULT '{}'::integer[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "sentinel_tt_config_notification_type_check" CHECK (("notification_type" = ANY (ARRAY['all'::"text", 'territories'::"text", 'factions'::"text", 'combined'::"text"])))
);


ALTER TABLE "public"."sentinel_tt_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_user_alerts" (
    "user_id" "uuid" NOT NULL,
    "module" "text" NOT NULL,
    "last_alert_sent_at" timestamp with time zone,
    "last_alert_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_user_alerts" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_user_alerts" IS 'Alerts for single Torn user in personalized mode.';



CREATE TABLE IF NOT EXISTS "public"."sentinel_user_build_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "build_id" "uuid" NOT NULL,
    "main_stat" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_user_build_preferences" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_user_build_preferences" IS 'User''s preferred stat build strategy and main stat focus for training recommendations';



COMMENT ON COLUMN "public"."sentinel_user_build_preferences"."main_stat" IS 'The primary stat to focus on for this build (strength, speed, dexterity, defense)';



COMMENT ON COLUMN "public"."sentinel_user_build_preferences"."updated_at" IS 'When the preference was last changed';



CREATE TABLE IF NOT EXISTS "public"."sentinel_user_data" (
    "player_id" integer NOT NULL,
    "name" "text",
    "is_donator" boolean DEFAULT false NOT NULL,
    "profile_image" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_user_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_user_data" IS 'Single Torn user profile data. Keyed by player_id. Discord integration removed.';



CREATE TABLE IF NOT EXISTS "public"."sentinel_user_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "energy_current" integer DEFAULT 0,
    "energy_maximum" integer DEFAULT 0,
    "nerve_current" integer DEFAULT 0,
    "nerve_maximum" integer DEFAULT 0,
    "happy_current" integer DEFAULT 0,
    "happy_maximum" integer DEFAULT 0,
    "life_current" integer DEFAULT 0,
    "life_maximum" integer DEFAULT 0,
    "chain_current" integer DEFAULT 0,
    "chain_maximum" integer DEFAULT 0,
    "energy_flat_time_to_full" integer,
    "energy_time_to_full" integer,
    "nerve_flat_time_to_full" integer,
    "nerve_time_to_full" integer,
    "drug_cooldown" integer DEFAULT 0,
    "medical_cooldown" integer DEFAULT 0,
    "booster_cooldown" integer DEFAULT 0,
    "bookie_updated_at" timestamp with time zone,
    "active_gym" integer,
    "can_boost_energy_perk" numeric DEFAULT 0,
    "liquid_cash" bigint,
    "bookie_value" bigint,
    "net_worth" bigint,
    "happy_flat_time_to_full" bigint,
    "life_flat_time_to_full" bigint,
    "chain_flat_time_to_full" bigint
);


ALTER TABLE "public"."sentinel_user_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_user_snapshots" IS 'Historical snapshots of user financial and stat data for trend analysis';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."energy_current" IS 'Current energy (from bars)';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."energy_maximum" IS 'Maximum energy (from bars)';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."nerve_current" IS 'Current nerve (from bars)';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."nerve_maximum" IS 'Maximum nerve (from bars)';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."happy_current" IS 'Current happiness (from bars)';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."happy_maximum" IS 'Maximum happiness (from bars)';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."life_current" IS 'Current life (from bars)';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."life_maximum" IS 'Maximum life (from bars)';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."chain_current" IS 'Current chain count';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."chain_maximum" IS 'Maximum chain achieved';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."drug_cooldown" IS 'Drug cooldown remaining in seconds';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."medical_cooldown" IS 'Medical cooldown remaining in seconds';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."booster_cooldown" IS 'Booster cooldown remaining in seconds';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."bookie_updated_at" IS 'Timestamp when bookie value was last updated from Torn API networth endpoint';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."active_gym" IS 'The gym ID where the user is currently training (from /user gym selection)';



COMMENT ON COLUMN "public"."sentinel_user_snapshots"."can_boost_energy_perk" IS 'Percentage bonus to energy gain from perks affecting energy drinks (e.g., 50 for +50%)';



CREATE TABLE IF NOT EXISTS "public"."sentinel_user_travel_settings" (
    "blacklisted_items" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "notification_threshold" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "player_id" bigint NOT NULL
);


ALTER TABLE "public"."sentinel_user_travel_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_user_travel_settings" IS 'Single Torn user travel settings. Keyed by player_id.';



CREATE TABLE IF NOT EXISTS "public"."sentinel_users" (
    "user_id" "uuid" NOT NULL,
    "api_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_users" OWNER TO "postgres";


COMMENT ON TABLE "public"."sentinel_users" IS 'DEPRECATED: No longer used in personalized single-user mode. Data removed.';



CREATE TABLE IF NOT EXISTS "public"."sentinel_verified_users" (
    "discord_id" "text" NOT NULL,
    "torn_id" integer NOT NULL,
    "torn_name" "text" NOT NULL,
    "faction_id" integer,
    "faction_tag" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_verified_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_war_ledger" (
    "war_id" integer NOT NULL,
    "territory_id" "text" NOT NULL,
    "assaulting_faction" integer NOT NULL,
    "defending_faction" integer NOT NULL,
    "victor_faction" integer,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sentinel_war_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sentinel_war_trackers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "guild_id" "text" NOT NULL,
    "war_id" integer NOT NULL,
    "territory_id" "text" NOT NULL,
    "channel_id" "text",
    "message_id" "text",
    "enemy_side" "text" NOT NULL,
    "min_away_minutes" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "sentinel_war_trackers_enemy_side_check" CHECK (("enemy_side" = ANY (ARRAY['assaulting'::"text", 'defending'::"text"])))
);


ALTER TABLE "public"."sentinel_war_trackers" OWNER TO "postgres";


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
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."sentinel_worker_schedules" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sentinel_worker_schedules"."metadata" IS 'Worker-specific metadata for optimizations (e.g., response_hash, consecutive_no_change_runs)';



CREATE TABLE IF NOT EXISTS "public"."sentinel_workers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sentinel_workers" OWNER TO "postgres";


ALTER TABLE ONLY "public"."sentinel_rate_limit_requests_per_user" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sentinel_rate_limit_requests_per_user_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sentinel_torn_categories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sentinel_torn_categories_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sentinel_torn_destinations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sentinel_torn_destinations_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sentinel_travel_stock_cache" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sentinel_travel_stock_cache_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sentinel_worker_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sentinel_worker_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sentinel_guild_api_keys"
    ADD CONSTRAINT "guild_api_keys_unique" UNIQUE ("guild_id", "api_key_encrypted");



ALTER TABLE ONLY "public"."sentinel_api_key_user_mapping"
    ADD CONSTRAINT "sentinel_api_key_user_mapping_pkey" PRIMARY KEY ("api_key_hash");



ALTER TABLE ONLY "public"."sentinel_assist_config"
    ADD CONSTRAINT "sentinel_assist_config_pkey" PRIMARY KEY ("guild_id");



ALTER TABLE ONLY "public"."sentinel_assist_tokens"
    ADD CONSTRAINT "sentinel_assist_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_assist_tokens"
    ADD CONSTRAINT "sentinel_assist_tokens_token_uuid_key" UNIQUE ("token_uuid");



ALTER TABLE ONLY "public"."sentinel_battlestats_snapshots"
    ADD CONSTRAINT "sentinel_battlestats_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_destination_travel_times"
    ADD CONSTRAINT "sentinel_destination_travel_times_pkey" PRIMARY KEY ("destination_id");



ALTER TABLE ONLY "public"."sentinel_faction_roles"
    ADD CONSTRAINT "sentinel_faction_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_finance_settings"
    ADD CONSTRAINT "sentinel_finance_settings_pkey" PRIMARY KEY ("player_id");



ALTER TABLE ONLY "public"."sentinel_guild_api_keys"
    ADD CONSTRAINT "sentinel_guild_api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_guild_audit"
    ADD CONSTRAINT "sentinel_guild_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_guild_config"
    ADD CONSTRAINT "sentinel_guild_modules_pkey" PRIMARY KEY ("guild_id");



ALTER TABLE ONLY "public"."sentinel_guild_sync_jobs"
    ADD CONSTRAINT "sentinel_guild_sync_jobs_pkey" PRIMARY KEY ("guild_id");



ALTER TABLE ONLY "public"."sentinel_rate_limit_requests_per_user"
    ADD CONSTRAINT "sentinel_rate_limit_requests_per_user_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_reaction_role_config"
    ADD CONSTRAINT "sentinel_reaction_role_config_pkey" PRIMARY KEY ("guild_id");



ALTER TABLE ONLY "public"."sentinel_reaction_role_mappings"
    ADD CONSTRAINT "sentinel_reaction_role_mappings_message_id_emoji_key" UNIQUE ("message_id", "emoji");



ALTER TABLE ONLY "public"."sentinel_reaction_role_mappings"
    ADD CONSTRAINT "sentinel_reaction_role_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_reaction_role_messages"
    ADD CONSTRAINT "sentinel_reaction_role_messages_message_id_key" UNIQUE ("message_id");



ALTER TABLE ONLY "public"."sentinel_reaction_role_messages"
    ADD CONSTRAINT "sentinel_reaction_role_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_revive_config"
    ADD CONSTRAINT "sentinel_revive_config_pkey" PRIMARY KEY ("guild_id");



ALTER TABLE ONLY "public"."sentinel_revive_requests"
    ADD CONSTRAINT "sentinel_revive_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_stat_build_configurations"
    ADD CONSTRAINT "sentinel_stat_build_configurations_build_id_main_stat_key" UNIQUE ("build_id", "main_stat");



ALTER TABLE ONLY "public"."sentinel_stat_build_configurations"
    ADD CONSTRAINT "sentinel_stat_build_configurations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_stat_builds"
    ADD CONSTRAINT "sentinel_stat_builds_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."sentinel_stat_builds"
    ADD CONSTRAINT "sentinel_stat_builds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_stat_builds"
    ADD CONSTRAINT "sentinel_stat_builds_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."sentinel_system_api_keys"
    ADD CONSTRAINT "sentinel_system_api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_territory_blueprint"
    ADD CONSTRAINT "sentinel_territory_blueprint_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_territory_state"
    ADD CONSTRAINT "sentinel_territory_state_pkey" PRIMARY KEY ("territory_id");



ALTER TABLE ONLY "public"."sentinel_torn_categories"
    ADD CONSTRAINT "sentinel_torn_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."sentinel_torn_categories"
    ADD CONSTRAINT "sentinel_torn_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_torn_destinations"
    ADD CONSTRAINT "sentinel_torn_destinations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."sentinel_torn_destinations"
    ADD CONSTRAINT "sentinel_torn_destinations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_torn_factions"
    ADD CONSTRAINT "sentinel_torn_factions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_torn_gyms"
    ADD CONSTRAINT "sentinel_torn_gyms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_torn_items"
    ADD CONSTRAINT "sentinel_torn_items_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."sentinel_training_recommendations"
    ADD CONSTRAINT "sentinel_training_recommendations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_travel_data"
    ADD CONSTRAINT "sentinel_travel_data_pkey" PRIMARY KEY ("player_id");



ALTER TABLE ONLY "public"."sentinel_travel_recommendations"
    ADD CONSTRAINT "sentinel_travel_recommendations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_travel_settings"
    ADD CONSTRAINT "sentinel_travel_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."sentinel_travel_stock_cache"
    ADD CONSTRAINT "sentinel_travel_stock_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_tt_config"
    ADD CONSTRAINT "sentinel_tt_config_pkey" PRIMARY KEY ("guild_id");



ALTER TABLE ONLY "public"."sentinel_user_alerts"
    ADD CONSTRAINT "sentinel_user_alerts_pkey" PRIMARY KEY ("user_id", "module");



ALTER TABLE ONLY "public"."sentinel_user_data"
    ADD CONSTRAINT "sentinel_user_data_pkey" PRIMARY KEY ("player_id");



ALTER TABLE ONLY "public"."sentinel_user_snapshots"
    ADD CONSTRAINT "sentinel_user_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_user_travel_settings"
    ADD CONSTRAINT "sentinel_user_travel_settings_pkey" PRIMARY KEY ("player_id");



ALTER TABLE ONLY "public"."sentinel_users"
    ADD CONSTRAINT "sentinel_users_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."sentinel_verified_users"
    ADD CONSTRAINT "sentinel_verified_users_pkey" PRIMARY KEY ("discord_id");



ALTER TABLE ONLY "public"."sentinel_verified_users"
    ADD CONSTRAINT "sentinel_verified_users_torn_id_key" UNIQUE ("torn_id");



ALTER TABLE ONLY "public"."sentinel_war_ledger"
    ADD CONSTRAINT "sentinel_war_ledger_pkey" PRIMARY KEY ("war_id");



ALTER TABLE ONLY "public"."sentinel_war_trackers"
    ADD CONSTRAINT "sentinel_war_trackers_guild_id_war_id_key" UNIQUE ("guild_id", "war_id");



ALTER TABLE ONLY "public"."sentinel_war_trackers"
    ADD CONSTRAINT "sentinel_war_trackers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_worker_logs"
    ADD CONSTRAINT "sentinel_worker_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_worker_schedules"
    ADD CONSTRAINT "sentinel_worker_schedules_pkey" PRIMARY KEY ("worker_id");



ALTER TABLE ONLY "public"."sentinel_workers"
    ADD CONSTRAINT "sentinel_workers_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."sentinel_workers"
    ADD CONSTRAINT "sentinel_workers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sentinel_faction_roles"
    ADD CONSTRAINT "unique_guild_faction" UNIQUE ("guild_id", "faction_id");



ALTER TABLE ONLY "public"."sentinel_user_build_preferences"
    ADD CONSTRAINT "user_build_preference_only_one" PRIMARY KEY ("id");



CREATE INDEX "idx_assist_tokens_discord" ON "public"."sentinel_assist_tokens" USING "btree" ("discord_id");



CREATE INDEX "idx_assist_tokens_guild_active" ON "public"."sentinel_assist_tokens" USING "btree" ("guild_id", "is_active");



CREATE INDEX "idx_assist_tokens_torn" ON "public"."sentinel_assist_tokens" USING "btree" ("torn_id");



CREATE INDEX "idx_battlestats_snapshots_created_at" ON "public"."sentinel_battlestats_snapshots" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_faction_roles_enabled" ON "public"."sentinel_faction_roles" USING "btree" ("enabled");



CREATE INDEX "idx_faction_roles_faction_id" ON "public"."sentinel_faction_roles" USING "btree" ("faction_id");



CREATE INDEX "idx_faction_roles_faction_name" ON "public"."sentinel_faction_roles" USING "btree" ("faction_name");



CREATE INDEX "idx_faction_roles_guild_id" ON "public"."sentinel_faction_roles" USING "btree" ("guild_id");



CREATE INDEX "idx_reaction_role_mappings_message" ON "public"."sentinel_reaction_role_mappings" USING "btree" ("message_id");



CREATE INDEX "idx_reaction_role_messages_channel" ON "public"."sentinel_reaction_role_messages" USING "btree" ("channel_id");



CREATE INDEX "idx_reaction_role_messages_guild" ON "public"."sentinel_reaction_role_messages" USING "btree" ("guild_id");



CREATE INDEX "idx_revive_requests_created_at" ON "public"."sentinel_revive_requests" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_revive_requests_guild_state" ON "public"."sentinel_revive_requests" USING "btree" ("guild_id", "state", "expires_at");



CREATE UNIQUE INDEX "idx_revive_requests_unique_active" ON "public"."sentinel_revive_requests" USING "btree" ("guild_id", "requester_discord_id") WHERE ("state" = 'active'::"text");



CREATE INDEX "idx_sentinel_guild_audit_created_at" ON "public"."sentinel_guild_audit" USING "btree" ("created_at");



CREATE INDEX "idx_sentinel_guild_audit_guild_id" ON "public"."sentinel_guild_audit" USING "btree" ("guild_id");



CREATE INDEX "idx_sentinel_worker_schedules_next_run" ON "public"."sentinel_worker_schedules" USING "btree" ("next_run_at");



CREATE INDEX "idx_stat_build_configurations_build_id" ON "public"."sentinel_stat_build_configurations" USING "btree" ("build_id");



CREATE INDEX "idx_stat_build_configurations_main_stat" ON "public"."sentinel_stat_build_configurations" USING "btree" ("main_stat");



CREATE INDEX "idx_stat_builds_slug" ON "public"."sentinel_stat_builds" USING "btree" ("slug");



CREATE INDEX "idx_territory_blueprint_sector" ON "public"."sentinel_territory_blueprint" USING "btree" ("sector");



CREATE INDEX "idx_territory_state_faction_id" ON "public"."sentinel_territory_state" USING "btree" ("faction_id");



CREATE INDEX "idx_territory_state_has_racket" ON "public"."sentinel_territory_state" USING "btree" ("territory_id") WHERE ("racket_name" IS NOT NULL);



CREATE INDEX "idx_territory_state_is_warring" ON "public"."sentinel_territory_state" USING "btree" ("is_warring") WHERE ("is_warring" = true);



CREATE INDEX "idx_torn_factions_name" ON "public"."sentinel_torn_factions" USING "btree" ("name");



CREATE INDEX "idx_torn_factions_tag" ON "public"."sentinel_torn_factions" USING "btree" ("tag");



CREATE INDEX "idx_torn_factions_updated_at" ON "public"."sentinel_torn_factions" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_torn_gyms_name" ON "public"."sentinel_torn_gyms" USING "btree" ("name");



CREATE INDEX "idx_torn_gyms_unlocked" ON "public"."sentinel_torn_gyms" USING "btree" ("unlocked");



CREATE INDEX "idx_torn_items_booster_cooldown" ON "public"."sentinel_torn_items" USING "btree" ("booster_cooldown_hours") WHERE ("booster_cooldown_hours" > 0);



CREATE INDEX "idx_torn_items_energy_gain" ON "public"."sentinel_torn_items" USING "btree" ("energy_gain") WHERE ("energy_gain" > 0);



CREATE INDEX "idx_tt_config_guild_id" ON "public"."sentinel_tt_config" USING "btree" ("guild_id");



CREATE INDEX "idx_user_build_preference_build_id" ON "public"."sentinel_user_build_preferences" USING "btree" ("build_id");



CREATE INDEX "idx_user_snapshots_created_at" ON "public"."sentinel_user_snapshots" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_verified_users_torn_id" ON "public"."sentinel_verified_users" USING "btree" ("torn_id");



CREATE INDEX "idx_war_ledger_assaulting_faction" ON "public"."sentinel_war_ledger" USING "btree" ("assaulting_faction");



CREATE INDEX "idx_war_ledger_defending_faction" ON "public"."sentinel_war_ledger" USING "btree" ("defending_faction");



CREATE INDEX "idx_war_ledger_start_time" ON "public"."sentinel_war_ledger" USING "btree" ("start_time" DESC);



CREATE INDEX "idx_war_ledger_territory_id" ON "public"."sentinel_war_ledger" USING "btree" ("territory_id");



CREATE INDEX "idx_war_ledger_victor_faction" ON "public"."sentinel_war_ledger" USING "btree" ("victor_faction");



CREATE INDEX "idx_worker_schedules_metadata" ON "public"."sentinel_worker_schedules" USING "gin" ("metadata");



CREATE INDEX "sentinel_api_key_user_mapping_user_id_idx" ON "public"."sentinel_api_key_user_mapping" USING "btree" ("user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "sentinel_guild_api_keys_guild_id_idx" ON "public"."sentinel_guild_api_keys" USING "btree" ("guild_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "sentinel_guild_api_keys_primary_idx" ON "public"."sentinel_guild_api_keys" USING "btree" ("guild_id", "is_primary") WHERE ("deleted_at" IS NULL);



CREATE INDEX "sentinel_guild_api_keys_user_id_idx" ON "public"."sentinel_guild_api_keys" USING "btree" ("user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "sentinel_guild_sync_jobs_next_sync_at_idx" ON "public"."sentinel_guild_sync_jobs" USING "btree" ("next_sync_at") WHERE (NOT "in_progress");



CREATE INDEX "sentinel_rate_limit_requests_per_user_key_idx" ON "public"."sentinel_rate_limit_requests_per_user" USING "btree" ("api_key_hash", "requested_at" DESC);



CREATE INDEX "sentinel_rate_limit_requests_user_id_idx" ON "public"."sentinel_rate_limit_requests_per_user" USING "btree" ("user_id", "requested_at" DESC);



CREATE UNIQUE INDEX "sentinel_system_api_keys_api_key_hash_unique" ON "public"."sentinel_system_api_keys" USING "btree" ("api_key_hash") WHERE (("deleted_at" IS NULL) AND ("api_key_hash" IS NOT NULL));



CREATE INDEX "sentinel_system_api_keys_primary_idx" ON "public"."sentinel_system_api_keys" USING "btree" ("user_id", "is_primary") WHERE ("deleted_at" IS NULL);



CREATE INDEX "sentinel_system_api_keys_user_id_idx" ON "public"."sentinel_system_api_keys" USING "btree" ("user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "sentinel_torn_categories_name_idx" ON "public"."sentinel_torn_categories" USING "btree" ("name");



CREATE UNIQUE INDEX "sentinel_torn_destinations_country_code_idx" ON "public"."sentinel_torn_destinations" USING "btree" ("country_code");



CREATE INDEX "sentinel_training_recommendations_created_at_idx" ON "public"."sentinel_training_recommendations" USING "btree" ("created_at" DESC);



CREATE INDEX "sentinel_travel_recommendations_profit_per_minute_idx" ON "public"."sentinel_travel_recommendations" USING "btree" ("profit_per_minute" DESC);



CREATE INDEX "sentinel_travel_recommendations_rank_idx" ON "public"."sentinel_travel_recommendations" USING "btree" ("recommendation_rank");



CREATE UNIQUE INDEX "sentinel_travel_recommendations_user_destination_idx" ON "public"."sentinel_travel_recommendations" USING "btree" ("user_id", "destination_id");



CREATE INDEX "sentinel_travel_recommendations_user_id_idx" ON "public"."sentinel_travel_recommendations" USING "btree" ("user_id");



CREATE INDEX "sentinel_travel_stock_cache_item_id_idx" ON "public"."sentinel_travel_stock_cache" USING "btree" ("item_id");



CREATE INDEX "sentinel_travel_stock_cache_last_updated_idx" ON "public"."sentinel_travel_stock_cache" USING "btree" ("last_updated");



CREATE INDEX "sentinel_user_alerts_last_sent_idx" ON "public"."sentinel_user_alerts" USING "btree" ("last_alert_sent_at");



CREATE INDEX "sentinel_user_alerts_module_idx" ON "public"."sentinel_user_alerts" USING "btree" ("module");



CREATE INDEX "sentinel_user_data_player_id_idx" ON "public"."sentinel_user_data" USING "btree" ("player_id");



CREATE INDEX "sentinel_war_trackers_channel_id_idx" ON "public"."sentinel_war_trackers" USING "btree" ("channel_id");



CREATE INDEX "sentinel_war_trackers_guild_id_idx" ON "public"."sentinel_war_trackers" USING "btree" ("guild_id");



CREATE INDEX "sentinel_worker_logs_run_started_idx" ON "public"."sentinel_worker_logs" USING "btree" ("run_started_at");



CREATE INDEX "sentinel_worker_logs_worker_id_idx" ON "public"."sentinel_worker_logs" USING "btree" ("worker_id");



CREATE OR REPLACE TRIGGER "sentinel_travel_data_set_updated_at" BEFORE UPDATE ON "public"."sentinel_travel_data" FOR EACH ROW EXECUTE FUNCTION "public"."sentinel_travel_data_update_timestamp"();



CREATE OR REPLACE TRIGGER "sentinel_user_travel_settings_set_updated_at" BEFORE UPDATE ON "public"."sentinel_user_travel_settings" FOR EACH ROW EXECUTE FUNCTION "public"."sentinel_user_travel_settings_update_timestamp"();



CREATE OR REPLACE TRIGGER "sentinel_users_set_updated_at" BEFORE UPDATE ON "public"."sentinel_users" FOR EACH ROW EXECUTE FUNCTION "public"."sentinel_users_update_timestamp"();



ALTER TABLE ONLY "public"."sentinel_travel_recommendations"
    ADD CONSTRAINT "fk_best_item_id" FOREIGN KEY ("best_item_id") REFERENCES "public"."sentinel_torn_items"("item_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sentinel_torn_items"
    ADD CONSTRAINT "fk_category_id" FOREIGN KEY ("category_id") REFERENCES "public"."sentinel_torn_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sentinel_faction_roles"
    ADD CONSTRAINT "fk_guild_id" FOREIGN KEY ("guild_id") REFERENCES "public"."sentinel_guild_config"("guild_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_reaction_role_mappings"
    ADD CONSTRAINT "fk_message_id" FOREIGN KEY ("message_id") REFERENCES "public"."sentinel_reaction_role_messages"("message_id") ON DELETE CASCADE DEFERRABLE;



ALTER TABLE ONLY "public"."sentinel_destination_travel_times"
    ADD CONSTRAINT "sentinel_destination_travel_times_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "public"."sentinel_torn_destinations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_guild_api_keys"
    ADD CONSTRAINT "sentinel_guild_api_keys_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "public"."sentinel_guild_config"("guild_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_guild_sync_jobs"
    ADD CONSTRAINT "sentinel_guild_sync_jobs_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "public"."sentinel_guild_config"("guild_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_stat_build_configurations"
    ADD CONSTRAINT "sentinel_stat_build_configurations_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "public"."sentinel_stat_builds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_territory_state"
    ADD CONSTRAINT "sentinel_territory_state_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "public"."sentinel_territory_blueprint"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_training_recommendations"
    ADD CONSTRAINT "sentinel_training_recommendations_best_method_id_fkey" FOREIGN KEY ("best_method_id") REFERENCES "public"."sentinel_torn_items"("item_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sentinel_travel_recommendations"
    ADD CONSTRAINT "sentinel_travel_recommendations_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "public"."sentinel_torn_destinations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_travel_recommendations"
    ADD CONSTRAINT "sentinel_travel_recommendations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_travel_settings"
    ADD CONSTRAINT "sentinel_travel_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_travel_stock_cache"
    ADD CONSTRAINT "sentinel_travel_stock_cache_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "public"."sentinel_torn_destinations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_travel_stock_cache"
    ADD CONSTRAINT "sentinel_travel_stock_cache_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."sentinel_torn_items"("item_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_tt_config"
    ADD CONSTRAINT "sentinel_tt_config_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "public"."sentinel_guild_config"("guild_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_user_alerts"
    ADD CONSTRAINT "sentinel_user_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_user_build_preferences"
    ADD CONSTRAINT "sentinel_user_build_preferences_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "public"."sentinel_stat_builds"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sentinel_users"
    ADD CONSTRAINT "sentinel_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_war_ledger"
    ADD CONSTRAINT "sentinel_war_ledger_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "public"."sentinel_territory_blueprint"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sentinel_war_trackers"
    ADD CONSTRAINT "sentinel_war_trackers_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "public"."sentinel_guild_config"("guild_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_worker_logs"
    ADD CONSTRAINT "sentinel_worker_logs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."sentinel_workers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sentinel_worker_schedules"
    ADD CONSTRAINT "sentinel_worker_schedules_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."sentinel_workers"("id") ON DELETE CASCADE;



CREATE POLICY "public reads factions" ON "public"."sentinel_torn_factions" FOR SELECT USING (true);



CREATE POLICY "public reads territories" ON "public"."sentinel_territory_blueprint" FOR SELECT USING (true);



CREATE POLICY "public reads territory state" ON "public"."sentinel_territory_state" FOR SELECT USING (true);



CREATE POLICY "public reads tt_config" ON "public"."sentinel_tt_config" FOR SELECT USING (true);



CREATE POLICY "public reads war ledger" ON "public"."sentinel_war_ledger" FOR SELECT USING (true);



ALTER TABLE "public"."sentinel_api_key_user_mapping" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_api_key_user_mapping_service_role" ON "public"."sentinel_api_key_user_mapping" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_battlestats_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_battlestats_snapshots_authenticated" ON "public"."sentinel_battlestats_snapshots" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "sentinel_battlestats_snapshots_service_role" ON "public"."sentinel_battlestats_snapshots" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_destination_travel_times" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_destination_travel_times_service_role" ON "public"."sentinel_destination_travel_times" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_finance_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_finance_settings_authenticated" ON "public"."sentinel_finance_settings" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "sentinel_finance_settings_service_role" ON "public"."sentinel_finance_settings" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_guild_api_keys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_guild_api_keys_service_role" ON "public"."sentinel_guild_api_keys" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_rate_limit_requests_per_user" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_rate_limit_requests_per_user_service_role" ON "public"."sentinel_rate_limit_requests_per_user" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_system_api_keys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_system_api_keys_service_role" ON "public"."sentinel_system_api_keys" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_territory_blueprint" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sentinel_territory_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sentinel_torn_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_torn_categories_select_all" ON "public"."sentinel_torn_categories" FOR SELECT USING (true);



CREATE POLICY "sentinel_torn_categories_select_public" ON "public"."sentinel_torn_categories" FOR SELECT USING (true);



CREATE POLICY "sentinel_torn_categories_service_role" ON "public"."sentinel_torn_categories" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_torn_destinations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_torn_destinations_service_role" ON "public"."sentinel_torn_destinations" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_torn_factions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sentinel_torn_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_torn_items_service_role" ON "public"."sentinel_torn_items" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_travel_data" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_travel_data_service_role" ON "public"."sentinel_travel_data" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_travel_recommendations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_travel_recommendations_select_self" ON "public"."sentinel_travel_recommendations" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "sentinel_travel_recommendations_service_role" ON "public"."sentinel_travel_recommendations" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_travel_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_travel_settings_insert_self" ON "public"."sentinel_travel_settings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "sentinel_travel_settings_select_self" ON "public"."sentinel_travel_settings" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "sentinel_travel_settings_service_role" ON "public"."sentinel_travel_settings" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "sentinel_travel_settings_update_self" ON "public"."sentinel_travel_settings" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."sentinel_travel_stock_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_travel_stock_cache_service_role" ON "public"."sentinel_travel_stock_cache" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_tt_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sentinel_user_alerts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_user_alerts_service_role" ON "public"."sentinel_user_alerts" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_user_data" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_user_data_service_role" ON "public"."sentinel_user_data" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_user_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_user_snapshots_authenticated" ON "public"."sentinel_user_snapshots" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "sentinel_user_snapshots_service_role" ON "public"."sentinel_user_snapshots" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_user_travel_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sentinel_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_users_select_self" ON "public"."sentinel_users" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "sentinel_users_update_self" ON "public"."sentinel_users" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."sentinel_war_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sentinel_worker_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_worker_logs_service_role" ON "public"."sentinel_worker_logs" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_worker_schedules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_worker_schedules_service_role" ON "public"."sentinel_worker_schedules" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sentinel_workers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentinel_workers_service_role" ON "public"."sentinel_workers" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role manages factions" ON "public"."sentinel_torn_factions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role manages territories" ON "public"."sentinel_territory_blueprint" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role manages territory state" ON "public"."sentinel_territory_state" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role manages tt_config" ON "public"."sentinel_tt_config" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role manages war ledger" ON "public"."sentinel_war_ledger" TO "service_role" USING (true) WITH CHECK (true);



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."sentinel_finalize_reaction_role_message"("p_record_id" bigint, "p_new_message_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sentinel_finalize_reaction_role_message"("p_record_id" bigint, "p_new_message_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sentinel_finalize_reaction_role_message"("p_record_id" bigint, "p_new_message_id" "text") TO "service_role";



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



GRANT ALL ON TABLE "public"."sentinel_api_key_user_mapping" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_api_key_user_mapping" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_api_key_user_mapping" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_assist_config" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_assist_config" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_assist_config" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_assist_tokens" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_assist_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_assist_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sentinel_assist_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sentinel_assist_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sentinel_assist_tokens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_battlestats_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_battlestats_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_battlestats_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_destination_travel_times" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_destination_travel_times" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_destination_travel_times" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_faction_roles" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_faction_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_faction_roles" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_finance_settings" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_finance_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_finance_settings" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_guild_api_keys" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_guild_api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_guild_api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_guild_audit" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_guild_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_guild_audit" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_guild_config" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_guild_config" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_guild_config" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_guild_sync_jobs" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_guild_sync_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_guild_sync_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_rate_limit_requests_per_user" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_rate_limit_requests_per_user" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_rate_limit_requests_per_user" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sentinel_rate_limit_requests_per_user_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sentinel_rate_limit_requests_per_user_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sentinel_rate_limit_requests_per_user_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_reaction_role_config" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_reaction_role_config" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_reaction_role_config" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_reaction_role_mappings" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_reaction_role_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_reaction_role_mappings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sentinel_reaction_role_mappings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sentinel_reaction_role_mappings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sentinel_reaction_role_mappings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_reaction_role_messages" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_reaction_role_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_reaction_role_messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sentinel_reaction_role_messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sentinel_reaction_role_messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sentinel_reaction_role_messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_revive_config" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_revive_config" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_revive_config" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_revive_requests" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_revive_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_revive_requests" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sentinel_revive_requests_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sentinel_revive_requests_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sentinel_revive_requests_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_stat_build_configurations" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_stat_build_configurations" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_stat_build_configurations" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_stat_builds" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_stat_builds" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_stat_builds" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_system_api_keys" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_system_api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_system_api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_territory_blueprint" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_territory_blueprint" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_territory_blueprint" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_territory_state" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_territory_state" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_territory_state" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_torn_categories" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_torn_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_torn_categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sentinel_torn_categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sentinel_torn_categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sentinel_torn_categories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_torn_destinations" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_torn_destinations" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_torn_destinations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sentinel_torn_destinations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sentinel_torn_destinations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sentinel_torn_destinations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_torn_factions" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_torn_factions" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_torn_factions" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_torn_gyms" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_torn_gyms" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_torn_gyms" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_torn_items" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_torn_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_torn_items" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_training_recommendations" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_training_recommendations" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_training_recommendations" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_travel_data" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_travel_data" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_travel_data" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_travel_recommendations" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_travel_recommendations" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_travel_recommendations" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_travel_settings" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_travel_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_travel_settings" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_travel_stock_cache" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_travel_stock_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_travel_stock_cache" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sentinel_travel_stock_cache_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sentinel_travel_stock_cache_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sentinel_travel_stock_cache_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_tt_config" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_tt_config" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_tt_config" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_user_alerts" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_user_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_user_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_user_build_preferences" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_user_build_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_user_build_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_user_data" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_user_data" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_user_data" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_user_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_user_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_user_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_user_travel_settings" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_user_travel_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_user_travel_settings" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_users" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_users" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_users" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_verified_users" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_verified_users" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_verified_users" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_war_ledger" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_war_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_war_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."sentinel_war_trackers" TO "anon";
GRANT ALL ON TABLE "public"."sentinel_war_trackers" TO "authenticated";
GRANT ALL ON TABLE "public"."sentinel_war_trackers" TO "service_role";



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







