import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/server-config";

export const dynamic = "force-dynamic";

async function handleProxy(req: NextRequest) {
  try {
    const url = new URL(req.url);
    // Path looks like /api/ledger/...
    // We want to proxy exactly the same path to the Fastify API.
    const backendPath = url.pathname;
    const searchParams = url.search;

    const env = getServerEnv();
    const apiUrl =
      env.API_URL ||
      env.NEXT_PUBLIC_API_URL ||
      env.BOT_ORIGIN ||
      "http://127.0.0.1:3001";

    const targetUrl = `${apiUrl.replace(/\/$/, "")}${backendPath}${searchParams}`;

    // Read the request body if it exists
    let body: string | null = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await req.text();
    }

    const headers = new Headers();
    req.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "host") {
        headers.set(key, value);
      }
    });

    if (!headers.has("content-type") && body) {
      headers.set("Content-Type", "application/json");
    }

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
    console.error("[Backend Proxy Error]:", error);
    return NextResponse.json(
      {
        error: "Proxy connection failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
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
