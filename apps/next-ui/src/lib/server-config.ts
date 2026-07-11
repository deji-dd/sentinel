import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface ServerEnv {
  BOT_ORIGIN?: string;
  NEXT_PUBLIC_BOT_ORIGIN?: string;
  API_URL?: string;
  NEXT_PUBLIC_API_URL?: string;
  VAPID_SUBJECT?: string;
  NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  PUSH_INTERNAL_SECRET?: string;
  SENTINEL_INTERNAL_SECRET?: string;
}

/** Safely narrow an unknown env binding value to string | undefined. */
function str(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

export function getServerEnv(): ServerEnv {
  let env: Record<string, unknown> = {};
  try {
    const context = getCloudflareContext();
    env = (context.env as Record<string, unknown>) || {};
  } catch {
    // Falls back to empty object when running in non-Cloudflare contexts (like next dev)
  }

  return {
    BOT_ORIGIN: str(env.BOT_ORIGIN) || process.env.BOT_ORIGIN,
    NEXT_PUBLIC_BOT_ORIGIN: str(env.NEXT_PUBLIC_BOT_ORIGIN) || process.env.NEXT_PUBLIC_BOT_ORIGIN,
    API_URL: str(env.API_URL) || process.env.API_URL,
    NEXT_PUBLIC_API_URL: str(env.NEXT_PUBLIC_API_URL) || process.env.NEXT_PUBLIC_API_URL,
    VAPID_SUBJECT: str(env.VAPID_SUBJECT) || process.env.VAPID_SUBJECT,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: str(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: str(env.VAPID_PRIVATE_KEY) || process.env.VAPID_PRIVATE_KEY,
    PUSH_INTERNAL_SECRET: str(env.PUSH_INTERNAL_SECRET) || process.env.PUSH_INTERNAL_SECRET,
    SENTINEL_INTERNAL_SECRET: str(env.SENTINEL_INTERNAL_SECRET) || process.env.SENTINEL_INTERNAL_SECRET,
  };
}
