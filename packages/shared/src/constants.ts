/** Centralized table name constants for Sentinel. */
export const TABLE_NAMES = {
  USERS: "sentinel_users",
  USER_DATA: "sentinel_user_data",
  USER_BARS: "sentinel_user_bars",
  USER_COOLDOWNS: "sentinel_user_cooldowns",
  TRAVEL_DATA: "sentinel_travel_data",
  TRAVEL_RECOMMENDATIONS: "sentinel_travel_recommendations",
  TRAVEL_SETTINGS: "sentinel_travel_settings",
  TRAVEL_STOCK_CACHE: "sentinel_travel_stock_cache",
  WORKERS: "sentinel_workers",
  WORKER_SCHEDULES: "sentinel_worker_schedules",
  WORKER_LOGS: "sentinel_worker_logs",
  TORN_ITEMS: "sentinel_torn_items",
  TORN_CATEGORIES: "sentinel_torn_categories",
  TORN_DESTINATIONS: "sentinel_torn_destinations",
  DESTINATION_TRAVEL_TIMES: "sentinel_destination_travel_times",
  RATE_LIMIT_REQUESTS_PER_USER: "sentinel_rate_limit_requests_per_user",
  USER_ALERTS: "sentinel_user_alerts",
  USER_SNAPSHOTS: "sentinel_user_snapshots",
  FINANCE_SETTINGS: "sentinel_finance_settings",
} as const;

/** Alert module types */
export const ALERT_MODULES = {
  TRAVEL: "travel",
  // Future: CRIMES: "crimes", FACTION: "faction", etc.
} as const;
