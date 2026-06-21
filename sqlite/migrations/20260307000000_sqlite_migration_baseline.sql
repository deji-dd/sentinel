-- Migration: sqlite_migration_baseline
-- Created (UTC): 2026-03-07T00:00:00.000Z

-- Core User and Data Tables
CREATE TABLE IF NOT EXISTS sentinel_users (
    user_id TEXT NOT NULL,
    api_key TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_users_user_id" ON "sentinel_users" ("user_id");

CREATE TABLE IF NOT EXISTS sentinel_user_data (
    player_id INTEGER PRIMARY KEY,
    name TEXT,
    is_donator INTEGER DEFAULT 0 NOT NULL,
    profile_image TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_user_data_player_id" ON "sentinel_user_data" ("player_id");

CREATE TABLE IF NOT EXISTS sentinel_user_bars (
    user_id TEXT NOT NULL,
    energy_current INTEGER DEFAULT 0 NOT NULL,
    energy_maximum INTEGER DEFAULT 0 NOT NULL,
    nerve_current INTEGER DEFAULT 0 NOT NULL,
    nerve_maximum INTEGER DEFAULT 0 NOT NULL,
    happy_current INTEGER DEFAULT 0 NOT NULL,
    happy_maximum INTEGER DEFAULT 0 NOT NULL,
    life_current INTEGER DEFAULT 0 NOT NULL,
    life_maximum INTEGER DEFAULT 0 NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    energy_flat_time_to_full INTEGER,
    energy_time_to_full INTEGER,
    nerve_flat_time_to_full INTEGER,
    nerve_time_to_full INTEGER
);

CREATE TABLE IF NOT EXISTS sentinel_user_cooldowns (
    user_id TEXT NOT NULL,
    drug INTEGER DEFAULT 0 NOT NULL,
    medical INTEGER DEFAULT 0 NOT NULL,
    booster INTEGER DEFAULT 0 NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Travel Tables
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_travel_data_player_id" ON "sentinel_travel_data" ("player_id");

CREATE TABLE IF NOT EXISTS sentinel_travel_recommendations (
    id TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_travel_recommendations_id" ON "sentinel_travel_recommendations" ("id");

CREATE TABLE IF NOT EXISTS sentinel_travel_settings (
    user_id TEXT NOT NULL,
    last_alert_sent TEXT,
    alert_cooldown_minutes INTEGER DEFAULT 60 NOT NULL,
    blacklisted_items TEXT,
    min_profit_per_trip INTEGER,
    min_profit_per_minute REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    blacklisted_categories TEXT,
    alerts_enabled INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_travel_settings_id" ON "sentinel_travel_settings" ("user_id");

CREATE TABLE IF NOT EXISTS sentinel_travel_stock_cache (
    id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    cost INTEGER NOT NULL,
    last_updated TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    destination_id INTEGER NOT NULL,
    ingested_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_travel_stock_cache_id" ON "sentinel_travel_stock_cache" ("id");

-- Worker Tables
CREATE TABLE IF NOT EXISTS sentinel_workers (
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_workers_name" ON "sentinel_workers" ("name");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_workers_id" ON "sentinel_workers" ("id");

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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_worker_schedules_worker_id" ON "sentinel_worker_schedules" ("worker_id");

-- Torn Static Data Tables
CREATE TABLE IF NOT EXISTS sentinel_torn_items (
    item_id INTEGER PRIMARY KEY,
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_torn_items_item_id" ON "sentinel_torn_items" ("item_id");

CREATE TABLE IF NOT EXISTS sentinel_torn_categories (
    id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_torn_categories_name" ON "sentinel_torn_categories" ("name");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_torn_categories_id" ON "sentinel_torn_categories" ("id");

CREATE TABLE IF NOT EXISTS sentinel_torn_gyms (
    id INTEGER PRIMARY KEY,
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_torn_gyms_id" ON "sentinel_torn_gyms" ("id");

CREATE TABLE IF NOT EXISTS sentinel_torn_destinations (
    id INTEGER NOT NULL,
    name TEXT NOT NULL,
    country_code TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_torn_destinations_name" ON "sentinel_torn_destinations" ("name");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_torn_destinations_id" ON "sentinel_torn_destinations" ("id");

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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_destination_travel_times_destination_id" ON "sentinel_destination_travel_times" ("destination_id");

-- API Keys mapping
CREATE TABLE IF NOT EXISTS sentinel_system_api_keys (
    id TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_system_api_keys_id" ON "sentinel_system_api_keys" ("id");

CREATE TABLE IF NOT EXISTS sentinel_guild_api_keys (
    id TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_guild_api_keys_guild_id_api_key_encrypted" ON "sentinel_guild_api_keys" ("guild_id", "api_key_encrypted");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_guild_api_keys_id" ON "sentinel_guild_api_keys" ("id");

CREATE TABLE IF NOT EXISTS sentinel_api_key_user_mapping (
    api_key_hash TEXT NOT NULL,
    source TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    user_id INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_api_key_user_mapping_api_key_hash" ON "sentinel_api_key_user_mapping" ("api_key_hash");

-- Alerts and Snapshots
CREATE TABLE IF NOT EXISTS sentinel_user_alerts (
    user_id TEXT NOT NULL,
    module TEXT NOT NULL,
    last_alert_sent_at TEXT,
    last_alert_data TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_user_alerts_user_id_module" ON "sentinel_user_alerts" ("user_id", "module");

CREATE TABLE IF NOT EXISTS sentinel_user_snapshots (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_user_snapshots_id" ON "sentinel_user_snapshots" ("id");

-- Finance Settings
CREATE TABLE IF NOT EXISTS sentinel_finance_settings (
    player_id INTEGER NOT NULL,
    min_reserve INTEGER DEFAULT 250000000 NOT NULL,
    split_bookie INTEGER DEFAULT 60 NOT NULL,
    split_training INTEGER DEFAULT 30 NOT NULL,
    split_gear INTEGER DEFAULT 10 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_finance_settings_player_id" ON "sentinel_finance_settings" ("player_id");

-- Training recommendations
CREATE TABLE IF NOT EXISTS sentinel_training_recommendations (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    stat TEXT,
    best_method_type TEXT,
    cost_per_stat REAL NOT NULL,
    estimated_gains_per_train INTEGER,
    max_quantity_affordable INTEGER DEFAULT 0 NOT NULL,
    best_method_id INTEGER,
    training_budget INTEGER,
    current_gym_sub_optimal INTEGER,
    better_gym_name TEXT,
    better_gym_bonus REAL,
    current_gym_bonus REAL,
    is_main_stat_focus INTEGER DEFAULT 0,
    priority_score REAL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_training_recommendations_id" ON "sentinel_training_recommendations" ("id");

CREATE TABLE IF NOT EXISTS sentinel_stat_builds (
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_stat_builds_name" ON "sentinel_stat_builds" ("name");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_stat_builds_id" ON "sentinel_stat_builds" ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_stat_builds_slug" ON "sentinel_stat_builds" ("slug");

CREATE TABLE IF NOT EXISTS sentinel_stat_build_configurations (
    id TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_stat_build_configurations_build_id_main_stat" ON "sentinel_stat_build_configurations" ("build_id", "main_stat");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_stat_build_configurations_id" ON "sentinel_stat_build_configurations" ("id");

CREATE TABLE IF NOT EXISTS sentinel_user_build_preferences (
    id TEXT NOT NULL,
    build_id TEXT NOT NULL,
    main_stat TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_user_build_preferences_id" ON "sentinel_user_build_preferences" ("id");

CREATE TABLE IF NOT EXISTS sentinel_verified_users (
    discord_id TEXT NOT NULL,
    torn_id INTEGER NOT NULL,
    torn_name TEXT NOT NULL,
    faction_id INTEGER,
    faction_tag TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_verified_users_discord_id" ON "sentinel_verified_users" ("discord_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_verified_users_torn_id" ON "sentinel_verified_users" ("torn_id");

CREATE TABLE IF NOT EXISTS sentinel_battlestats_snapshots (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    strength INTEGER NOT NULL,
    speed INTEGER NOT NULL,
    defense INTEGER NOT NULL,
    dexterity INTEGER NOT NULL,
    total_stats INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_battlestats_snapshots_id" ON "sentinel_battlestats_snapshots" ("id");

-- Guild Settings
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_guild_config_guild_id" ON "sentinel_guild_config" ("guild_id");

CREATE TABLE IF NOT EXISTS sentinel_guild_sync_jobs (
    guild_id TEXT NOT NULL,
    last_sync_at TEXT,
    next_sync_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    in_progress INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_guild_sync_jobs_guild_id" ON "sentinel_guild_sync_jobs" ("guild_id");

CREATE TABLE IF NOT EXISTS sentinel_guild_audit (
    id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    actor_discord_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_guild_audit_id" ON "sentinel_guild_audit" ("id");

CREATE TABLE IF NOT EXISTS sentinel_faction_roles (
    id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    faction_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    member_role_ids TEXT DEFAULT '[]' NOT NULL,
    faction_name TEXT,
    enabled INTEGER DEFAULT 1 NOT NULL,
    leader_role_ids TEXT DEFAULT '[]' NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_faction_roles_id" ON "sentinel_faction_roles" ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_faction_roles_guild_id_faction_id" ON "sentinel_faction_roles" ("guild_id", "faction_id");

-- Territory map tables
CREATE TABLE IF NOT EXISTS sentinel_territory_blueprint (
    id TEXT PRIMARY KEY,
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_territory_blueprint_id" ON "sentinel_territory_blueprint" ("id");

CREATE TABLE IF NOT EXISTS sentinel_territory_state (
    territory_id TEXT PRIMARY KEY,
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_territory_state_territory_id" ON "sentinel_territory_state" ("territory_id");

CREATE TABLE IF NOT EXISTS sentinel_war_ledger (
    war_id INTEGER PRIMARY KEY,
    territory_id TEXT NOT NULL,
    assaulting_faction INTEGER NOT NULL,
    defending_faction INTEGER NOT NULL,
    victor_faction INTEGER,
    start_time TEXT NOT NULL,
    end_time TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_war_ledger_war_id" ON "sentinel_war_ledger" ("war_id");

CREATE TABLE IF NOT EXISTS sentinel_war_trackers (
    id TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_war_trackers_guild_id_war_id" ON "sentinel_war_trackers" ("guild_id", "war_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_war_trackers_id" ON "sentinel_war_trackers" ("id");

CREATE TABLE IF NOT EXISTS sentinel_torn_factions (
    id INTEGER PRIMARY KEY,
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_torn_factions_id" ON "sentinel_torn_factions" ("id");

CREATE TABLE IF NOT EXISTS sentinel_tt_config (
    guild_id TEXT NOT NULL,
    notification_type TEXT DEFAULT 'all' NOT NULL,
    territory_ids TEXT DEFAULT '[]',
    faction_ids TEXT DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_tt_config_guild_id" ON "sentinel_tt_config" ("guild_id");

-- Reaction Roles
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_reaction_role_messages_message_id" ON "sentinel_reaction_role_messages" ("message_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_reaction_role_messages_id" ON "sentinel_reaction_role_messages" ("id");

CREATE TABLE IF NOT EXISTS sentinel_reaction_role_mappings (
    id INTEGER NOT NULL,
    message_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    role_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_reaction_role_mappings_message_id_emoji" ON "sentinel_reaction_role_mappings" ("message_id", "emoji");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_reaction_role_mappings_id" ON "sentinel_reaction_role_mappings" ("id");

CREATE TABLE IF NOT EXISTS sentinel_reaction_role_config (
    guild_id TEXT NOT NULL,
    allowed_role_ids TEXT DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_reaction_role_config_guild_id" ON "sentinel_reaction_role_config" ("guild_id");

-- Revives
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_revive_config_guild_id" ON "sentinel_revive_config" ("guild_id");

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
    expires_at TEXT NOT NULL,
    completed_by_discord_id TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sentinel_revive_requests_id" ON "sentinel_revive_requests" ("id");

-- Map Editing/Viewing
CREATE TABLE IF NOT EXISTS sentinel_maps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sentinel_map_labels (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL,
    label_text TEXT NOT NULL,
    color_hex TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (map_id) REFERENCES sentinel_maps(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_map_labels_map_id ON sentinel_map_labels(map_id);

CREATE TABLE IF NOT EXISTS sentinel_map_sessions (
    token TEXT PRIMARY KEY,
    map_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (map_id) REFERENCES sentinel_maps(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_map_sessions_expires_at ON sentinel_map_sessions(expires_at);

CREATE TABLE IF NOT EXISTS sentinel_map_territories (
    map_id TEXT NOT NULL,
    territory_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (map_id, territory_id),
    FOREIGN KEY (map_id) REFERENCES sentinel_maps(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES sentinel_map_labels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_map_territories_map_id ON sentinel_map_territories(map_id);

-- Web/Dashboard Auth Sessions
CREATE TABLE IF NOT EXISTS sentinel_dashboard_sessions (
    token TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sentinel_auth_tokens (
    token TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    target_path TEXT NOT NULL,
    is_used INTEGER DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON sentinel_auth_tokens(expires_at);

CREATE TABLE IF NOT EXISTS sentinel_web_sessions (
    session_token TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    device_id TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON sentinel_web_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_web_sessions_discord_id ON sentinel_web_sessions(discord_id);

CREATE TABLE IF NOT EXISTS sentinel_revoked_users (
    discord_id TEXT PRIMARY KEY,
    revoked_by TEXT NOT NULL,
    reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sentinel_map_history (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    FOREIGN KEY (map_id) REFERENCES sentinel_maps(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_map_history_map_id ON sentinel_map_history(map_id);
