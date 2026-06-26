"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FlaskConical, Send, Bell } from "lucide-react";
import { toast } from "sonner";

// ─── Push Notification Tester ────────────────────────────────────────────────

function PushTester() {
  const [title, setTitle] = useState("Sentinel Alert");
  const [body, setBody] = useState("This is a test notification from the Beta playground.");
  const [url, setUrl] = useState("/");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [result, setResult] = useState("");

  const send = async () => {
    setStatus("sending");
    setResult("");
    try {
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, url }),
      });
      const data = await res.json() as { sent?: number; error?: string; note?: string };
      if (res.ok) {
        setStatus("sent");
        const msg = data.note ?? `✓ Delivered`;
        setResult(msg);
        toast.success(msg);
      } else {
        setStatus("error");
        const errMsg = `Error: ${data.error}`;
        setResult(errMsg);
        toast.error(errMsg);
      }
    } catch (err) {
      setStatus("error");
      const errMsg = `Network error: ${err}`;
      setResult(errMsg);
      toast.error(errMsg);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition";

  return (
    <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-base">Push Notification Tester</CardTitle>
        </div>
        <CardDescription>
          Send a test push to all subscribed browsers. Make sure you clicked{" "}
          <strong>Alerts On</strong> in the sidebar first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-500">Title</label>
          <input
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Notification title"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-500">Body</label>
          <textarea
            className={`${inputCls} resize-none h-20`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Notification body text"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-500">URL (on click)</label>
          <input
            className={inputCls}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={send}
            disabled={status === "sending"}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="h-4 w-4" />
            {status === "sending" ? "Sending…" : "Send Test Push"}
          </button>
          {result && (
            <span
              className={`text-xs font-mono ${status === "error" ? "text-rose-500" : "text-emerald-500"
                }`}
            >
              {result}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Drop your test components below ────────────────────────────────────────
// Import whatever you're working on and add it to BetaComponents.

const BetaComponents: React.FC[] = [
  PushTester,
  // Add more test components here ↓
];

// ─────────────────────────────────────────────────────────────────────────────

export default function BetaPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 border border-violet-500/20">
            <FlaskConical className="h-4 w-4 text-violet-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Beta Playground</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Drop components into{" "}
              <code className="font-mono bg-zinc-100 dark:bg-zinc-900 px-1 rounded text-xs">
                src/app/beta/page.tsx
              </code>{" "}
              to preview them here.
            </p>
          </div>
        </div>

        {/* Component slots */}
        <div className="grid gap-6">
          {BetaComponents.map((Component, i) => (
            <div key={i} className="space-y-2">
              <p className="text-xs font-mono text-zinc-400 dark:text-zinc-600 select-none">
                — component {i + 1}:{" "}
                <span className="text-violet-500">{Component.name || "Anonymous"}</span>
              </p>
              <Component />
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
