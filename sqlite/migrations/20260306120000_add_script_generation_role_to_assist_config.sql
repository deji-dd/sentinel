-- Add script_generation_role_ids to assist_config table
ALTER TABLE sentinel_assist_config
  ADD COLUMN script_generation_role_ids TEXT DEFAULT '[]' NOT NULL;
