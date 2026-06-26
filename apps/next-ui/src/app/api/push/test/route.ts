// src/app/api/push/test/route.ts
import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import https from "https";
import { readSubscriptions, writeSubscriptions } from "@/lib/push-store";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

const ipv4Agent = new https.Agent({ family: 4 });

/** POST /api/push/test — internal test endpoint, no secret required.
 *  Accepts same-origin requests AND any Tailscale / trusted dev origins.
 */
export async function POST(req: NextRequest) {
  // Allow: localhost, 127.x, and any host that matches the request's own host
  // (covers Tailscale HTTPS dev URLs like macbook-pro.taile7ef20.ts.net)
  const host = req.headers.get("host") ?? "";
  const origin = req.headers.get("origin") ?? "";
  const referer = req.headers.get("referer") ?? "";

  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.");
  const isSameHost =
    origin.includes(host) || referer.includes(host) || origin === "";

  if (!isLocalhost && !isSameHost) {
    return NextResponse.json({ error: "Forbidden", host, origin }, { status: 403 });
  }

  const { title = "Sentinel", body = "Test notification", url = "/" } = await req.json();
  const subs = await readSubscriptions();

  if (subs.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      note: "No subscribers yet — enable Alerts in the sidebar first.",
    });
  }

  const payload = JSON.stringify({ title, body, url });
  const results = await Promise.allSettled(
    subs.map((sub) => webpush.sendNotification(sub, payload, { agent: ipv4Agent }))
  );

  const expired: string[] = [];
  const errors: string[] = [];

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const err = r.reason as { statusCode?: number; body?: string; message?: string };
      const statusCode = err?.statusCode ?? 0;
      if (statusCode === 410 || statusCode === 404) {
        expired.push(subs[i].endpoint);
      } else {
        // Surface the real error instead of silently dropping it
        const detail = err?.body ?? err?.message ?? String(r.reason);
        errors.push(`[${statusCode}] ${detail}`);
        console.error("[push/test] Send failed:", err);
      }
    }
  });

  if (expired.length) {
    await writeSubscriptions(subs.filter((s) => !expired.includes(s.endpoint)));
  }

  const sent = results.filter((r) => r.status === "fulfilled").length;

  if (errors.length > 0) {
    return NextResponse.json({
      ok: false,
      sent,
      errors,
      note: errors.join(" | "),
    }, { status: 207 });
  }

  return NextResponse.json({ ok: true, sent });
}
