-- Add sync interval setting to guild config
ALTER TABLE IF EXISTS public.sentinel_guild_config
ADD COLUMN IF NOT EXISTS sync_interval_seconds INTEGER DEFAULT 3600;

-- Create table to track per-guild sync scheduling
CREATE TABLE IF NOT EXISTS public.sentinel_guild_sync_jobs (
    guild_id TEXT PRIMARY KEY REFERENCES public.sentinel_guild_config(guild_id) ON DELETE CASCADE,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    next_sync_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    in_progress BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index for scheduler polling
CREATE INDEX IF NOT EXISTS sentinel_guild_sync_jobs_next_sync_at_idx 
ON public.sentinel_guild_sync_jobs(next_sync_at) 
WHERE NOT in_progress;

-- Ensure all existing guilds have sync jobs
INSERT INTO public.sentinel_guild_sync_jobs (guild_id, next_sync_at)
SELECT guild_id, now()
FROM public.sentinel_guild_config
ON CONFLICT (guild_id) DO NOTHING;
