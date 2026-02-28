/**
 * Central export point for all config command handlers
 * Organized by domain for maintainability
 */

// Navigation handlers (menu navigation)
export * from "./navigation.js";

// Territory handlers (TT module)
export * from "./territories.js";

// Note: Existing handlers in config.ts should be gradually moved here:
// - Verification handlers (verification.ts)
// - API key handlers (api-keys.ts)
// - Guild admin handlers (guild.ts)
