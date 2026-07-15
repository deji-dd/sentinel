import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js 16 middleware due to Cloudflare hosting.
 * Runs on every matched request before the app renders.
 *
 * - Checks `/api/config` to determine if the system is configured.
 * - Redirects unconfigured users to `/onboarding`.
 * - Redirects configured users away from `/onboarding` to `/`.
 * - Redirects to `/error-offline` if the API is unreachable.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip API routes, static assets, Next.js internals, and the error page itself
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/error-offline" ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".webmanifest")
  ) {
    return NextResponse.next();
  }

  const apiUrl = (
    process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001"
  ).replace(/\/$/, "");
  const secret = process.env.SENTINEL_INTERNAL_SECRET;

  try {
    const res = await fetch(`${apiUrl}/api/config`, {
      headers: secret ? { "x-sentinel-secret": secret } : {},
      signal: AbortSignal.timeout(2000),
    });

    if (!res.ok) {
      return NextResponse.redirect(new URL("/error-offline", request.url));
    }

    const data = await res.json();
    const isOnboarding = pathname === "/onboarding";

    if (!data.configured && !isOnboarding) {
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }
    if (data.configured && isOnboarding) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  } catch {
    // API unreachable — redirect to error page
    return NextResponse.redirect(new URL("/error-offline", request.url));
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon|api|error-offline|.*\\.(?:png|ico|svg|webmanifest)).*)",
  ],
};
