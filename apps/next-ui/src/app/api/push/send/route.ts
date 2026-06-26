// src/app/api/push/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import https from "https";
import { readSubscriptions, writeSubscriptions } from "@/lib/push-store";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);

const ipv4Agent = new https.Agent({ family: 4 });

/** POST /api/push/send
 *  Body: { title, body, url?, icon? }
 *  Header: x-push-secret: <PUSH_INTERNAL_SECRET>
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-push-secret");
  const expected = process.env.PUSH_INTERNAL_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { title = "Sentinel", body = "", url = "/", icon } = await req.json();
  const subs = await readSubscriptions();
  if (subs.length === 0) return NextResponse.json({ ok: true, sent: 0 });

  const payload = JSON.stringify({ title, body, url, icon });
  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(sub, payload, { agent: ipv4Agent }),
    ),
  );

  const expired: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const err = r.reason as { statusCode?: number };
      if (err?.statusCode === 410 || err?.statusCode === 404)
        expired.push(subs[i].endpoint);
      else console.error("[push/send] Failed:", err);
    }
  });
  if (expired.length) {
    await writeSubscriptions(subs.filter((s) => !expired.includes(s.endpoint)));
  }

  return NextResponse.json({
    ok: true,
    sent: results.filter((r) => r.status === "fulfilled").length,
  });
}
