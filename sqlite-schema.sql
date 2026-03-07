-- SQLite schema converted from PostgreSQL dump
-- Generated: 2026-03-07T10:29:34.653Z

PRAGMA foreign_keys = OFF;

-- Table: sentinel_users
CREATE TABLE IF NOT EXISTS sentinel_users (
    user_id TEXT NOT NULL,
    api_key TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_users_pkey ON sentinel_users (user_id);

-- Table: sentinel_user_data
CREATE TABLE IF NOT EXISTS sentinel_user_data (
    player_id INTEGER NOT NULL,
    name TEXT,
    is_donator INTEGER DEFAULT 0 NOT NULL,
    profile_image TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_user_data_pkey ON sentinel_user_data (player_id);

-- Table: sentinel_travel_data
CREATE TABLE IF NOT EXISTS sentinel_travel_data (
    travel_destination TEXT,
    travel_method TEXT,
    travel_departed_at TEXT,
    travel_arrival_at TEXT,
    travel_time_left INTEGER,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    capacity INTEGER DEFAULT 5,
    has_airstrip INTEGER DEFAULT 0 NOT NULL,
    has_wlt_benefit INTEGER DEFAULT 0 NOT NULL,
    active_travel_book INTEGER DEFAULT 0 NOT NULL,
    player_id INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_travel_data_pkey ON sentinel_travel_data (player_id);

-- Table: sentinel_travel_recommendations
CREATE TABLE IF NOT EXISTS sentinel_travel_recommendations (
    id TEXT  NOT NULL,
    user_id TEXT NOT NULL,
    profit_per_trip INTEGER,
    profit_per_minute REAL,
    round_trip_minutes INTEGER,
    recommendation_rank INTEGER,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    destination_id INTEGER NOT NULL,
    best_item_id INTEGER,
    message TEXT,
    cash_to_carry INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_travel_recommendations_pkey ON sentinel_travel_recommendations (id);

-- Table: sentinel_travel_settings
CREATE TABLE IF NOT EXISTS sentinel_travel_settings (
    user_id TEXT NOT NULL,
    last_alert_sent TEXT,
    alert_cooldown_minutes INTEGER DEFAULT 60 NOT NULL,
    blacklisted_items TEXT DEFAULT '[]',
    min_profit_per_trip INTEGER,
    min_profit_per_minute REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    blacklisted_categories TEXT DEFAULT '[]',
    alerts_enabled INTEGER DEFAULT 1 NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_travel_settings_pkey ON sentinel_travel_settings (user_id);

-- Table: sentinel_travel_stock_cache
CREATE TABLE IF NOT EXISTS sentinel_travel_stock_cache (
    id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    cost INTEGER NOT NULL,
    last_updated TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    destination_id INTEGER NOT NULL,
    ingested_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_travel_stock_cache_pkey ON sentinel_travel_stock_cache (id);

-- Table: sentinel_workers
CREATE TABLE IF NOT EXISTS sentinel_workers (
    id TEXT  NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_workers_name_key ON sentinel_workers (name);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_workers_pkey ON sentinel_workers (id);

-- Table: sentinel_worker_schedules
CREATE TABLE IF NOT EXISTS sentinel_worker_schedules (
    worker_id TEXT NOT NULL,
    enabled INTEGER DEFAULT 1 NOT NULL,
    force_run INTEGER DEFAULT 0 NOT NULL,
    cadence_seconds INTEGER NOT NULL,
    next_run_at TEXT NOT NULL,
    last_run_at TEXT,
    attempts INTEGER DEFAULT 0 NOT NULL,
    backoff_until TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT DEFAULT '[]'
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_worker_schedules_pkey ON sentinel_worker_schedules (worker_id);

-- Table: sentinel_worker_logs
CREATE TABLE IF NOT EXISTS sentinel_worker_logs (
    id TEXT NOT NULL,
    worker_id TEXT NOT NULL,
    run_started_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    run_finished_at TEXT,
    duration_ms INTEGER,
    status TEXT NOT NULL,
    message TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_limited INTEGER DEFAULT 0,
    limited_until TEXT,
    last_error_at TEXT
    
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_worker_logs_pkey ON sentinel_worker_logs (id);

-- Table: sentinel_torn_items
CREATE TABLE IF NOT EXISTS sentinel_torn_items (
    item_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    image TEXT,
    type TEXT,
    category_id INTEGER,
    effect TEXT,
    energy_gain INTEGER DEFAULT 0,
    happy_gain INTEGER DEFAULT 0,
    cooldown TEXT,
    value INTEGER,
    booster_cooldown_hours INTEGER DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_torn_items_pkey ON sentinel_torn_items (item_id);

-- Table: sentinel_torn_categories
CREATE TABLE IF NOT EXISTS sentinel_torn_categories (
    id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_torn_categories_name_key ON sentinel_torn_categories (name);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_torn_categories_pkey ON sentinel_torn_categories (id);

-- Table: sentinel_torn_gyms
CREATE TABLE IF NOT EXISTS sentinel_torn_gyms (
    id INTEGER NOT NULL,
    name TEXT NOT NULL,
    energy INTEGER NOT NULL,
    strength INTEGER NOT NULL,
    speed INTEGER NOT NULL,
    dexterity INTEGER NOT NULL,
    defense INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    unlocked INTEGER DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_torn_gyms_pkey ON sentinel_torn_gyms (id);

-- Table: sentinel_torn_destinations
CREATE TABLE IF NOT EXISTS sentinel_torn_destinations (
    id INTEGER NOT NULL,
    name TEXT NOT NULL,
    country_code TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_torn_destinations_name_key ON sentinel_torn_destinations (name);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_torn_destinations_pkey ON sentinel_torn_destinations (id);

-- Table: sentinel_destination_travel_times
CREATE TABLE IF NOT EXISTS sentinel_destination_travel_times (
    destination_id INTEGER NOT NULL,
    standard INTEGER DEFAULT 0 NOT NULL,
    airstrip INTEGER DEFAULT 0 NOT NULL,
    wlt INTEGER DEFAULT 0 NOT NULL,
    bct INTEGER DEFAULT 0 NOT NULL,
    standard_w_book INTEGER DEFAULT 0 NOT NULL,
    airstrip_w_book INTEGER DEFAULT 0 NOT NULL,
    wlt_w_book INTEGER DEFAULT 0 NOT NULL,
    bct_w_book INTEGER DEFAULT 0 NOT NULL,
    standard_cost INTEGER DEFAULT 0 NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_destination_travel_times_pkey ON sentinel_destination_travel_times (destination_id);

-- Table: sentinel_rate_limit_requests_per_user
CREATE TABLE IF NOT EXISTS sentinel_rate_limit_requests_per_user (
    id TEXT NOT NULL,
    api_key_hash TEXT NOT NULL,
    requested_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    user_id INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_rate_limit_requests_per_user_pkey ON sentinel_rate_limit_requests_per_user (id);

-- Table: sentinel_system_api_keys
CREATE TABLE IF NOT EXISTS sentinel_system_api_keys (
    id TEXT  NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    is_primary INTEGER DEFAULT 0,
    key_type TEXT DEFAULT 'personal',
    invalid_count INTEGER DEFAULT 0,
    last_invalid_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT,
    deleted_at TEXT,
    user_id INTEGER NOT NULL,
    api_key_hash TEXT
    
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_system_api_keys_pkey ON sentinel_system_api_keys (id);

-- Table: sentinel_guild_api_keys
CREATE TABLE IF NOT EXISTS sentinel_guild_api_keys (
    id TEXT  NOT NULL,
    guild_id TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    is_primary INTEGER DEFAULT 0,
    provided_by TEXT NOT NULL,
    invalid_count INTEGER DEFAULT 0,
    last_invalid_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT,
    deleted_at TEXT,
    user_id INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS guild_api_keys_unique ON sentinel_guild_api_keys (guild_id, api_key_encrypted);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_guild_api_keys_pkey ON sentinel_guild_api_keys (id);

-- Table: sentinel_api_key_user_mapping
CREATE TABLE IF NOT EXISTS sentinel_api_key_user_mapping (
    api_key_hash TEXT NOT NULL,
    source TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    user_id INTEGER NOT NULL
    
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_api_key_user_mapping_pkey ON sentinel_api_key_user_mapping (api_key_hash);

-- Table: sentinel_user_alerts
CREATE TABLE IF NOT EXISTS sentinel_user_alerts (
    user_id TEXT NOT NULL,
    module TEXT NOT NULL,
    last_alert_sent_at TEXT,
    last_alert_data TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_user_alerts_pkey ON sentinel_user_alerts (user_id, module);

-- Table: sentinel_user_snapshots
CREATE TABLE IF NOT EXISTS sentinel_user_snapshots (
    id TEXT  NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    energy_current INTEGER DEFAULT 0,
    energy_maximum INTEGER DEFAULT 0,
    nerve_current INTEGER DEFAULT 0,
    nerve_maximum INTEGER DEFAULT 0,
    happy_current INTEGER DEFAULT 0,
    happy_maximum INTEGER DEFAULT 0,
    life_current INTEGER DEFAULT 0,
    life_maximum INTEGER DEFAULT 0,
    chain_current INTEGER DEFAULT 0,
    chain_maximum INTEGER DEFAULT 0,
    energy_flat_time_to_full INTEGER,
    energy_time_to_full INTEGER,
    nerve_flat_time_to_full INTEGER,
    nerve_time_to_full INTEGER,
    drug_cooldown INTEGER DEFAULT 0,
    medical_cooldown INTEGER DEFAULT 0,
    booster_cooldown INTEGER DEFAULT 0,
    bookie_updated_at TEXT,
    active_gym INTEGER,
    can_boost_energy_perk REAL DEFAULT 0,
    liquid_cash INTEGER,
    bookie_value INTEGER,
    net_worth INTEGER,
    happy_flat_time_to_full INTEGER,
    life_flat_time_to_full INTEGER,
    chain_flat_time_to_full INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_user_snapshots_pkey ON sentinel_user_snapshots (id);

-- Table: sentinel_finance_settings
CREATE TABLE IF NOT EXISTS sentinel_finance_settings (
    player_id INTEGER NOT NULL,
    min_reserve INTEGER DEFAULT 250000000 NOT NULL,
    split_bookie INTEGER DEFAULT 60 NOT NULL,
    split_training INTEGER DEFAULT 30 NOT NULL,
    split_gear INTEGER DEFAULT 10 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_finance_settings_pkey ON sentinel_finance_settings (player_id);

-- Table: sentinel_training_recommendations
CREATE TABLE IF NOT EXISTS sentinel_training_recommendations (
    id TEXT  NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    best_method TEXT NOT NULL,
    cost_per_stat REAL NOT NULL,
    recommended_qty INTEGER NOT NULL,
    details TEXT,
    max_quantity_affordable INTEGER DEFAULT 0 NOT NULL,
    best_method_id INTEGER,
    better_gym_name TEXT,
    is_main_stat_focus INTEGER DEFAULT 0,
    priority_score REAL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_training_recommendations_pkey ON sentinel_training_recommendations (id);

-- Table: sentinel_stat_builds
CREATE TABLE IF NOT EXISTS sentinel_stat_builds (
    id TEXT  NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_stat_builds_name_key ON sentinel_stat_builds (name);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_stat_builds_pkey ON sentinel_stat_builds (id);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_stat_builds_slug_key ON sentinel_stat_builds (slug);

-- Table: sentinel_stat_build_configurations
CREATE TABLE IF NOT EXISTS sentinel_stat_build_configurations (
    id TEXT  NOT NULL,
    build_id TEXT NOT NULL,
    main_stat TEXT NOT NULL,
    strength_value INTEGER NOT NULL,
    speed_value INTEGER NOT NULL,
    dexterity_value INTEGER NOT NULL,
    defense_value INTEGER NOT NULL,
    strength_percentage REAL,
    speed_percentage REAL,
    dexterity_percentage REAL,
    defense_percentage REAL,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_stat_build_configurations_build_id_main_stat_key ON sentinel_stat_build_configurations (build_id, main_stat);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_stat_build_configurations_pkey ON sentinel_stat_build_configurations (id);

-- Table: sentinel_user_build_preferences
CREATE TABLE IF NOT EXISTS sentinel_user_build_preferences (
    id TEXT  NOT NULL,
    build_id TEXT NOT NULL,
    main_stat TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS user_build_preference_only_one ON sentinel_user_build_preferences (id);

-- Table: sentinel_verified_users
CREATE TABLE IF NOT EXISTS sentinel_verified_users (
    discord_id TEXT NOT NULL,
    torn_id INTEGER NOT NULL,
    torn_name TEXT NOT NULL,
    faction_id INTEGER,
    faction_tag TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_verified_users_pkey ON sentinel_verified_users (discord_id);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_verified_users_torn_id_key ON sentinel_verified_users (torn_id);

-- Table: sentinel_battlestats_snapshots
CREATE TABLE IF NOT EXISTS sentinel_battlestats_snapshots (
    id TEXT  NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    strength INTEGER NOT NULL,
    speed INTEGER NOT NULL,
    defense INTEGER NOT NULL,
    dexterity INTEGER NOT NULL,
    total_stats INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_battlestats_snapshots_pkey ON sentinel_battlestats_snapshots (id);

-- Table: sentinel_guild_config
CREATE TABLE IF NOT EXISTS sentinel_guild_config (
    guild_id TEXT NOT NULL,
    enabled_modules TEXT DEFAULT '[]',
    admin_role_ids TEXT DEFAULT '[]',
    verified_role_ids TEXT DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    nickname_template TEXT DEFAULT '{name}#{id}',
    auto_verify INTEGER DEFAULT 0,
    sync_interval_seconds INTEGER DEFAULT 3600,
    verified_role_id TEXT,
    log_channel_id TEXT,
    tt_full_channel_id TEXT,
    tt_filtered_channel_id TEXT,
    tt_territory_ids TEXT DEFAULT '[]',
    tt_faction_ids TEXT DEFAULT '[]'
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_guild_modules_pkey ON sentinel_guild_config (guild_id);

-- Table: sentinel_guild_sync_jobs
CREATE TABLE IF NOT EXISTS sentinel_guild_sync_jobs (
    guild_id TEXT NOT NULL,
    last_sync_at TEXT,
    next_sync_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    in_progress INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_guild_sync_jobs_pkey ON sentinel_guild_sync_jobs (guild_id);

-- Table: sentinel_guild_audit
CREATE TABLE IF NOT EXISTS sentinel_guild_audit (
    id TEXT  NOT NULL,
    guild_id TEXT NOT NULL,
    actor_discord_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_guild_audit_pkey ON sentinel_guild_audit (id);

-- Table: sentinel_faction_roles
CREATE TABLE IF NOT EXISTS sentinel_faction_roles (
    id TEXT  NOT NULL,
    guild_id TEXT NOT NULL,
    faction_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    member_role_ids TEXT DEFAULT '[]' NOT NULL,
    faction_name TEXT,
    enabled INTEGER DEFAULT 1 NOT NULL,
    leader_role_ids TEXT DEFAULT '[]' NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_faction_roles_pkey ON sentinel_faction_roles (id);

CREATE UNIQUE INDEX IF NOT EXISTS unique_guild_faction ON sentinel_faction_roles (guild_id, faction_id);

-- Table: sentinel_territory_blueprint
CREATE TABLE IF NOT EXISTS sentinel_territory_blueprint (
    id TEXT NOT NULL,
    sector INTEGER NOT NULL,
    size INTEGER NOT NULL,
    density INTEGER NOT NULL,
    slots INTEGER NOT NULL,
    respect INTEGER NOT NULL,
    coordinate_x REAL NOT NULL,
    coordinate_y REAL NOT NULL,
    neighbors TEXT DEFAULT '[]' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_territory_blueprint_pkey ON sentinel_territory_blueprint (id);

-- Table: sentinel_territory_state
CREATE TABLE IF NOT EXISTS sentinel_territory_state (
    territory_id TEXT NOT NULL,
    faction_id INTEGER,
    is_warring INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    racket_name TEXT,
    racket_level INTEGER,
    racket_reward TEXT,
    racket_created_at INTEGER,
    racket_changed_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_territory_state_pkey ON sentinel_territory_state (territory_id);

-- Table: sentinel_war_ledger
CREATE TABLE IF NOT EXISTS sentinel_war_ledger (
    war_id INTEGER NOT NULL,
    territory_id TEXT NOT NULL,
    assaulting_faction INTEGER NOT NULL,
    defending_faction INTEGER NOT NULL,
    victor_faction INTEGER,
    start_time TEXT NOT NULL,
    end_time TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_war_ledger_pkey ON sentinel_war_ledger (war_id);

-- Table: sentinel_war_trackers
CREATE TABLE IF NOT EXISTS sentinel_war_trackers (
    id TEXT  NOT NULL,
    guild_id TEXT NOT NULL,
    war_id INTEGER NOT NULL,
    territory_id TEXT NOT NULL,
    channel_id TEXT,
    message_id TEXT,
    enemy_side TEXT NOT NULL,
    min_away_minutes INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_war_trackers_guild_id_war_id_key ON sentinel_war_trackers (guild_id, war_id);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_war_trackers_pkey ON sentinel_war_trackers (id);

-- Table: sentinel_torn_factions
CREATE TABLE IF NOT EXISTS sentinel_torn_factions (
    id INTEGER NOT NULL,
    name TEXT NOT NULL,
    tag TEXT NOT NULL,
    tag_image TEXT,
    leader_id INTEGER,
    co_leader_id INTEGER,
    respect INTEGER NOT NULL,
    days_old INTEGER,
    capacity INTEGER NOT NULL,
    members INTEGER NOT NULL,
    is_enlisted INTEGER,
    rank TEXT,
    best_chain INTEGER,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_torn_factions_pkey ON sentinel_torn_factions (id);

-- Table: sentinel_tt_config
CREATE TABLE IF NOT EXISTS sentinel_tt_config (
    guild_id TEXT NOT NULL,
    notification_type TEXT DEFAULT 'all' NOT NULL,
    territory_ids TEXT DEFAULT '[]',
    faction_ids TEXT DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_tt_config_pkey ON sentinel_tt_config (guild_id);

-- Table: sentinel_reaction_role_messages
CREATE TABLE IF NOT EXISTS sentinel_reaction_role_messages (
    id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_reaction_role_messages_message_id_key ON sentinel_reaction_role_messages (message_id);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_reaction_role_messages_pkey ON sentinel_reaction_role_messages (id);

-- Table: sentinel_reaction_role_mappings
CREATE TABLE IF NOT EXISTS sentinel_reaction_role_mappings (
    id INTEGER NOT NULL,
    message_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    role_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_reaction_role_mappings_message_id_emoji_key ON sentinel_reaction_role_mappings (message_id, emoji);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_reaction_role_mappings_pkey ON sentinel_reaction_role_mappings (id);

-- Table: sentinel_reaction_role_config
CREATE TABLE IF NOT EXISTS sentinel_reaction_role_config (
    guild_id TEXT NOT NULL,
    allowed_role_ids TEXT DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_reaction_role_config_pkey ON sentinel_reaction_role_config (guild_id);

-- Table: sentinel_revive_config
CREATE TABLE IF NOT EXISTS sentinel_revive_config (
    guild_id TEXT NOT NULL,
    request_channel_id TEXT,
    requests_output_channel_id TEXT,
    min_hospital_seconds_left INTEGER DEFAULT 0 NOT NULL,
    request_message_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ping_role_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_revive_config_pkey ON sentinel_revive_config (guild_id);

-- Table: sentinel_revive_requests
CREATE TABLE IF NOT EXISTS sentinel_revive_requests (
    id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    requester_discord_id TEXT NOT NULL,
    request_channel_id TEXT,
    request_message_id TEXT,
    requester_torn_id INTEGER,
    requester_torn_name TEXT,
    revivable INTEGER,
    status_description TEXT,
    status_details TEXT,
    status_state TEXT,
    hospital_until INTEGER,
    hospital_seconds_left INTEGER,
    faction_id INTEGER,
    last_action_status TEXT,
    last_action_relative TEXT,
    last_action_timestamp INTEGER,
    state TEXT DEFAULT 'active' NOT NULL,
    expires_at TEXT  NOT NULL,
    completed_by_discord_id TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    
);

CREATE UNIQUE INDEX IF NOT EXISTS sentinel_revive_requests_pkey ON sentinel_revive_requests (id);

PRAGMA foreign_keys = ON;