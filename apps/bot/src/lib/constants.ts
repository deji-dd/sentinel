/** Centralized table name constants for Sentinel Bot. */
export const TABLE_NAMES = {
  USERS: "sentinel_users",
  USER_DATA: "sentinel_user_data",
  TRAVEL_DATA: "sentinel_travel_data",
  TRAVEL_RECOMMENDATIONS: "sentinel_travel_recommendations",
} as const;

/** Torn API error codes with user-friendly messages */
export const TORN_ERROR_CODES: Record<number, string> = {
  0: "Unknown error: An unhandled error occurred",
  1: "Key is empty: API key is empty in current request",
  2: "Incorrect Key: API key is wrong/incorrect format",
  3: "Wrong type: Requesting an incorrect basic type",
  4: "Wrong fields: Requesting incorrect selection fields",
  5: "Too many requests: Rate limited (max 100 per minute)",
  6: "Incorrect ID: Wrong ID value",
  7: "Incorrect ID-entity relation: A requested selection is private",
  8: "IP block: Current IP is banned for a period of time due to abuse",
  9: "API disabled: API system is currently disabled",
  10: "Key owner in federal jail: Current key cannot be used",
  11: "Key change error: Can only change API key once every 60 seconds",
  12: "Key read error: Error reading key from database",
  13: "Key temporarily disabled: Owner hasn't been online for more than 7 days",
  14: "Daily read limit reached: Too many records pulled today",
  15: "Temporary error: Testing error code",
  16: "Access level insufficient: Key does not have permission for this selection",
  17: "Backend error: Please try again",
  18: "API key paused: Key has been paused by the owner",
  19: "Must be migrated to crimes 2.0",
  20: "Race not yet finished",
  21: "Incorrect category: Wrong cat value",
  22: "Only available in API v1",
  23: "Only available in API v2",
  24: "Closed temporarily",
} as const;
