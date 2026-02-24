/** Centralized table name constants for Sentinel. */
export declare const TABLE_NAMES: {
    readonly USERS: "sentinel_users";
    readonly USER_DATA: "sentinel_user_data";
    readonly USER_BARS: "sentinel_user_bars";
    readonly USER_COOLDOWNS: "sentinel_user_cooldowns";
    readonly TRAVEL_DATA: "sentinel_travel_data";
    readonly TRAVEL_RECOMMENDATIONS: "sentinel_travel_recommendations";
    readonly TRAVEL_SETTINGS: "sentinel_travel_settings";
    readonly TRAVEL_STOCK_CACHE: "sentinel_travel_stock_cache";
    readonly WORKERS: "sentinel_workers";
    readonly WORKER_SCHEDULES: "sentinel_worker_schedules";
    readonly WORKER_LOGS: "sentinel_worker_logs";
    readonly TORN_ITEMS: "sentinel_torn_items";
    readonly TORN_CATEGORIES: "sentinel_torn_categories";
    readonly TORN_GYMS: "sentinel_torn_gyms";
    readonly TORN_DESTINATIONS: "sentinel_torn_destinations";
    readonly DESTINATION_TRAVEL_TIMES: "sentinel_destination_travel_times";
    readonly RATE_LIMIT_REQUESTS_PER_USER: "sentinel_rate_limit_requests_per_user";
    readonly SYSTEM_API_KEYS: "sentinel_system_api_keys";
    readonly GUILD_API_KEYS: "sentinel_guild_api_keys";
    readonly API_KEY_USER_MAPPING: "sentinel_api_key_user_mapping";
    readonly USER_ALERTS: "sentinel_user_alerts";
    readonly USER_SNAPSHOTS: "sentinel_user_snapshots";
    readonly FINANCE_SETTINGS: "sentinel_finance_settings";
    readonly TRAINING_RECOMMENDATIONS: "sentinel_training_recommendations";
    readonly STAT_BUILDS: "sentinel_stat_builds";
    readonly STAT_BUILD_CONFIGURATIONS: "sentinel_stat_build_configurations";
    readonly STAT_BUILD_PREFERENCES: "sentinel_user_build_preferences";
    readonly VERIFIED_USERS: "sentinel_verified_users";
    readonly GUILD_CONFIG: "sentinel_guild_config";
    readonly GUILD_SYNC_JOBS: "sentinel_guild_sync_jobs";
    readonly GUILD_AUDIT: "sentinel_guild_audit";
    readonly FACTION_ROLES: "sentinel_faction_roles";
    readonly TERRITORY_BLUEPRINT: "sentinel_territory_blueprint";
    readonly TERRITORY_STATE: "sentinel_territory_state";
    readonly WAR_LEDGER: "sentinel_war_ledger";
    readonly TORN_FACTIONS: "sentinel_torn_factions";
    readonly TT_CONFIG: "sentinel_tt_config";
};
/** Alert module types */
export declare const ALERT_MODULES: {
    readonly TRAVEL: "travel";
};
/** Rate limiting constants */
export declare const RATE_LIMITING: {
    /** Max requests per minute per Torn user across all API keys and guilds */
    readonly MAX_REQUESTS_PER_MINUTE: 50;
    /** Window size for rate limiting (1 minute) */
    readonly WINDOW_MS: 60000;
};
//# sourceMappingURL=constants.d.ts.map