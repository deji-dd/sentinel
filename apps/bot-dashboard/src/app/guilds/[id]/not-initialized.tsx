"use client";

import { useState } from "react";
import { toast } from "sonner";
import { requestInitialization } from "@/actions/guilds";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert, ArrowLeft, Send } from "lucide-react";
import Link from "next/link";

export function NotInitializedView({ guildId, guildName }: { guildId: string; guildName: string }) {
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);

  const handleRequest = async () => {
    setLoading(true);
    try {
      const res = await requestInitialization(guildId);
      if (res.success) {
        setRequested(true);
        toast.success("Initialization request sent successfully to the bot owner!");
      } else {
        toast.error(res.error || "Failed to submit request.");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 overflow-hidden selection:bg-emerald-500/30">
      {/* Background Atmosphere (Mirroring Login Page) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-linear-to-br from-zinc-100 to-zinc-50 dark:from-zinc-900 dark:to-zinc-950" />
        <div className="absolute top-[-10%] left-[-10%] h-[500px] w-[500px] rounded-full bg-blue-500/10 dark:bg-blue-600/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[500px] w-[500px] rounded-full bg-indigo-500/10 dark:bg-indigo-600/20 blur-[120px]" />

        {/* Subtle Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000005_1px,transparent_1px),linear-gradient(to_bottom,#00000005_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)]" />
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center p-6 md:p-12 w-full">
        <Card className="max-w-[448px] w-full bg-white/60 dark:bg-zinc-900/60 border border-black/5 dark:border-white/5 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.05)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.3)] hover:border-amber-500/20 transition-all duration-500">
          <CardHeader className="text-center pb-6 border-b border-black/5 dark:border-white/5">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/20 mb-4 animate-pulse">
              <ShieldAlert className="size-6 text-amber-600 dark:text-amber-400" />
            </div>
            <CardTitle className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
              Sentinel Initialization Required
            </CardTitle>
            <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 max-w-xs mx-auto">
              This server exists on Discord, but its configuration database has not been initialized by an administrator yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="rounded-xl bg-black/5 dark:bg-black/40 border border-black/5 dark:border-white/5 p-4 text-xs font-mono text-zinc-500 dark:text-zinc-400 space-y-2">
              <div className="flex justify-between">
                <span className="text-zinc-400 dark:text-zinc-500">TARGET GUILD:</span>
                <span className="text-zinc-800 dark:text-zinc-300 font-bold max-w-[200px] truncate text-right" title={guildName}>{guildName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400 dark:text-zinc-500">DATABASE STATUS:</span>
                <span className="text-amber-600 dark:text-amber-400 font-bold">UNINITIALIZED</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/" className="flex-1">
                <Button variant="outline" className="w-full h-11 border-black/10 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5">
                  <ArrowLeft className="size-4 mr-2" />
                  Dashboard
                </Button>
              </Link>
              <Button
                onClick={handleRequest}
                disabled={loading || requested}
                className="flex-1 h-11 bg-zinc-900 dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-100 font-bold shadow-[0_4px_20px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(255,255,255,0.1)] transition-all"
              >
                <Send className="size-4 mr-2" />
                {requested ? "Request Sent" : loading ? "Sending..." : "Request Init"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
