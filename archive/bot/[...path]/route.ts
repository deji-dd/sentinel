import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/server-config";

export const dynamic = "force-dynamic";

async function handleProxy(req: NextRequest) {
  try {
    const url = new URL(req.url);
    // Path looks like /api/bot/config/personal/...
    // We want to replace /api/bot with /api and proxy to the bot server.
    const botPath = url.pathname.replace(/^\/api\/bot/, "/api");
    const searchParams = url.search;

    const env = getServerEnv();
    const botOrigin = env.BOT_ORIGIN || env.NEXT_PUBLIC_BOT_ORIGIN;

    if (!botOrigin) {
      throw new Error(
        "BOT_ORIGIN or NEXT_PUBLIC_BOT_ORIGIN is not defined. Please configure it in your environment/bindings."
      );
    }

    const targetUrl = `${botOrigin.replace(/\/$/, "")}${botPath}${searchParams}`;

    // Read the request body if it exists
    let body: string | null = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await req.text();
    }

    // Set up request headers, forcing Authorization header so the bot's MagicLinkService
    // bypasses check and authenticates as the owner.
    const headers = new Headers();
    req.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "host") {
        headers.set(key, value);
      }
    });
    
    if (!headers.has("content-type")) {
      headers.set("Content-Type", "application/json");
    }
    headers.set("Authorization", "Bearer dev-token");

    if (env.SENTINEL_INTERNAL_SECRET) {
      headers.set("x-sentinel-secret", env.SENTINEL_INTERNAL_SECRET);
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body || undefined,
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }

    return NextResponse.json(data, {
      status: response.status,
    });
  } catch (error: unknown) {
    console.error("[Bot Proxy Error]:", error);
    return NextResponse.json(
      { error: "Proxy connection failed", details: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleProxy(req);
}

export async function POST(req: NextRequest) {
  return handleProxy(req);
}

export async function PATCH(req: NextRequest) {
  return handleProxy(req);
}

export async function PUT(req: NextRequest) {
  return handleProxy(req);
}

export async function DELETE(req: NextRequest) {
  return handleProxy(req);
}
