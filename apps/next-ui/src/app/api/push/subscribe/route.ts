// src/app/api/push/subscribe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readSubscriptions, writeSubscriptions, type StoredSubscription } from "@/lib/push-store";

/** POST — save a new PushSubscription */
export async function POST(req: NextRequest) {
  try {
    const sub = await req.json() as StoredSubscription;
    if (!sub?.endpoint) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });

    const subs = await readSubscriptions();
    if (!subs.some((s) => s.endpoint === sub.endpoint)) {
      subs.push(sub);
      await writeSubscriptions(subs);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe POST]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** DELETE — remove a subscription by endpoint */
export async function DELETE(req: NextRequest) {
  try {
    const { endpoint } = await req.json() as { endpoint: string };
    if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

    const subs = await readSubscriptions();
    await writeSubscriptions(subs.filter((s) => s.endpoint !== endpoint));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe DELETE]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
