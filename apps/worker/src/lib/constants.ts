/** Centralized table name constants for Sentinel worker. */
export const TABLE_NAMES = {
  USERS: "sentinel_users",
  USER_DATA: "sentinel_user_data",
  USER_BARS: "sentinel_user_bars",
  USER_COOLDOWNS: "sentinel_user_cooldowns",
  TRAVEL_DATA: "sentinel_travel_data",
  WORKER_SCHEDULES: "sentinel_worker_schedules",
  TRADE_ITEMS: "sentinel_trade_items",
  MARKET_TRENDS: "sentinel_market_trends",
} as const;
