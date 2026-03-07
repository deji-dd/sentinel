import { createClient } from "@supabase/supabase-js";

// Use local or production database endpoint.
const isDev = process.env.NODE_ENV === "development";
const dbUrl = isDev
  ? process.env.DATABASE_URL_LOCAL ||
    process.env.SUPABASE_URL_LOCAL ||
    "http://127.0.0.1:54321"
  : process.env.DATABASE_URL || process.env.SUPABASE_URL!;
const dbServiceKey = isDev
  ? process.env.DATABASE_SERVICE_ROLE_KEY_LOCAL ||
    process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL!
  : process.env.DATABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!dbUrl || !dbServiceKey) {
  throw new Error(
    `Missing database credentials for ${isDev ? "local" : "production"} environment`,
  );
}

console.log(
  `[DB] Connected to ${isDev ? "local" : "production"} endpoint: ${dbUrl}`,
);

export const db = createClient(dbUrl, dbServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
