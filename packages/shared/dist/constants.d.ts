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
    readonly TORN_DESTINATIONS: "sentinel_torn_destinations";
    readonly DESTINATION_TRAVEL_TIMES: "sentinel_destination_travel_times";
    readonly RATE_LIMIT_REQUESTS_PER_USER: "sentinel_rate_limit_requests_per_user";
    readonly USER_ALERTS: "sentinel_user_alerts";
};
/** Alert module types */
export declare const ALERT_MODULES: {
    readonly TRAVEL: "travel";
};
/** Validation constants for user settings */
export declare const SETTINGS_LIMITS: {
    TRAVEL: {
        MIN_ALERT_COOLDOWN_MINUTES: number;
        MIN_PROFIT_PER_TRIP: number;
        MIN_PROFIT_PER_MINUTE: number;
        MAX_BLACKLISTED_ITEMS: number;
        MAX_BLACKLISTED_CATEGORIES: number;
    };
};
//# sourceMappingURL=constants.d.ts.map