/** Centralized table name constants for Sentinel worker. */
export const TABLE_NAMES = {
  USERS: "sentinel_users",
  USERS_DATA: "sentinel_users_data",
  TRAVEL_DATA: "sentinel_travel_data",
  USER_WORKER_SCHEDULES: "sentinel_user_worker_schedules",
  TRADE_ITEMS: "sentinel_trade_items",
  MARKET_TRENDS: "sentinel_market_trends",
} as const;
