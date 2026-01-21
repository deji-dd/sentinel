import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Routes that should redirect authenticated users away
 * (e.g., home page - already logged-in users should go to dashboard)
 */
const AUTH_ONLY_ROUTES = ["/"];

/**
 * Protected routes that require authentication
 */
const PROTECTED_ROUTES = ["/dashboard"];

/**
 * Simple in-memory rate limiter for auth routes
 * In production, use Redis or a proper rate limiting service
 */
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(
  identifier: string,
  maxAttempts: number = 5,
  windowMs: number = 60000,
): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(identifier);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(identifier, {
      count: 1,
      resetTime: now + windowMs,
    });
    return true;
  }

  if (record.count >= maxAttempts) {
    return false;
  }

  record.count++;
  return true;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Create Supabase client to refresh auth session
  const supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  /**
   * Refresh session - updates auth tokens if needed
   * This implements the updateSession pattern
   */
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Extract IP for rate limiting
  const ip =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown";

  // Rate limit on auth routes
  if (AUTH_ONLY_ROUTES.includes(pathname)) {
    if (!checkRateLimit(`auth:${ip}`, 10, 60000)) {
      return NextResponse.json(
        { error: "Too many authentication attempts. Please try again later." },
        { status: 429 },
      );
    }
  }

  // Route protection logic
  if (PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
    // Protected routes require authentication
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  if (AUTH_ONLY_ROUTES.includes(pathname)) {
    // Auth routes: redirect authenticated users away
    if (user) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return supabaseResponse;
}

/**
 * Matcher configuration
 * Excludes static assets, images, fonts, and other non-route files
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - `_next/static` (static files)
     * - `_next/image` (image optimization files)
     * - `favicon.ico` (favicon file)
     * - `public` folder
     * - Any file with an extension (images, fonts, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)$).*)",
  ],
};
