-- Seed data for stat builds
-- Hank's Ratio configurations
WITH hanks_ratio_build AS (
  INSERT INTO "public"."sentinel_stat_builds" (name, slug, description, notes)
  VALUES (
    'Hank''s Ratio',
    'hanks-ratio',
    'An extreme build strategy that maximizes one combat-critical stat (Dex or Defense) while minimizing the complementary stat. One stat is very high, one is very low, and two are balanced. The high stat must be either Defense or Dexterity due to combat mechanics.',
    'Most commonly used with Defense as high stat and Dexterity as low stat, though the reverse is also viable.'
  )
  RETURNING id
),

-- Insert Hank's Ratio configurations (Defense high, Dexterity low)
_hanks_defense_high AS (
  INSERT INTO "public"."sentinel_stat_build_configurations" (
    build_id, main_stat, 
    strength_value, speed_value, dexterity_value, defense_value,
    strength_percentage, speed_percentage, dexterity_percentage, defense_percentage,
    notes
  )
  SELECT 
    id, 'defense',
    80000000, 80000000, 28000000, 100000000,
    27.78, 27.78, 9.72, 34.72,
    'Defense as primary stat - optimal for defensive/tanking playstyle'
  FROM hanks_ratio_build
),

-- Insert Hank's Ratio configurations (Dexterity high, Defense low)
_hanks_dexterity_high AS (
  INSERT INTO "public"."sentinel_stat_build_configurations" (
    build_id, main_stat,
    strength_value, speed_value, dexterity_value, defense_value,
    strength_percentage, speed_percentage, dexterity_percentage, defense_percentage,
    notes
  )
  SELECT
    id, 'dexterity',
    80000000, 80000000, 100000000, 28000000,
    27.78, 27.78, 34.72, 9.72,
    'Dexterity as primary stat - optimal for dodge/accuracy playstyle'
  FROM hanks_ratio_build
),

-- Baldr's Ratio build
baldrs_ratio_build AS (
  INSERT INTO "public"."sentinel_stat_builds" (name, slug, description, notes)
  VALUES (
    'Baldr''s Ratio',
    'baldrs-ratio',
    'A balanced build strategy where stats are much closer together in value. No stat drops below ~22% of total, creating a more versatile but less specialized build. Can use any stat as primary with relatively balanced distribution.',
    'More forgiving than Hank''s Ratio if you fall off the plan, but less optimized for specific combat scenarios.'
  )
  RETURNING id
),

-- Insert Baldr's Ratio configurations
_baldrs_strength_high AS (
  INSERT INTO "public"."sentinel_stat_build_configurations" (
    build_id, main_stat,
    strength_value, speed_value, dexterity_value, defense_value,
    strength_percentage, speed_percentage, dexterity_percentage, defense_percentage,
    notes
  )
  SELECT
    id, 'strength',
    100000000, 80000000, 72000000, 72000000,
    30.86, 24.69, 22.22, 22.22,
    'Strength as primary stat - balanced melee-focused build'
  FROM baldrs_ratio_build
),

_baldrs_speed_high AS (
  INSERT INTO "public"."sentinel_stat_build_configurations" (
    build_id, main_stat,
    strength_value, speed_value, dexterity_value, defense_value,
    strength_percentage, speed_percentage, dexterity_percentage, defense_percentage,
    notes
  )
  SELECT
    id, 'speed',
    72000000, 100000000, 72000000, 80000000,
    22.22, 30.86, 22.22, 24.69,
    'Speed as primary stat - balanced action-economy build'
  FROM baldrs_ratio_build
),

_baldrs_dexterity_high AS (
  INSERT INTO "public"."sentinel_stat_build_configurations" (
    build_id, main_stat,
    strength_value, speed_value, dexterity_value, defense_value,
    strength_percentage, speed_percentage, dexterity_percentage, defense_percentage,
    notes
  )
  SELECT
    id, 'dexterity',
    80000000, 72000000, 100000000, 72000000,
    24.69, 22.22, 30.86, 22.22,
    'Dexterity as primary stat - balanced accuracy-focused build'
  FROM baldrs_ratio_build
),

_baldrs_defense_high AS (
  INSERT INTO "public"."sentinel_stat_build_configurations" (
    build_id, main_stat,
    strength_value, speed_value, dexterity_value, defense_value,
    strength_percentage, speed_percentage, dexterity_percentage, defense_percentage,
    notes
  )
  SELECT
    id, 'defense',
    72000000, 80000000, 72000000, 100000000,
    22.22, 24.69, 22.22, 30.86,
    'Defense as primary stat - balanced defensive build'
  FROM baldrs_ratio_build
)

SELECT 'Stat builds seeded successfully' as result;
