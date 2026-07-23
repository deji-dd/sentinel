"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldOff, ArrowLeft } from "lucide-react";
import Link from "next/link";

export function UnauthorizedView({ guildId, guildName }: { guildId: string; guildName: string }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 overflow-hidden selection:bg-emerald-500/30">
      {/* Background Atmosphere (Mirroring Login Page) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-linear-to-br from-zinc-100 to-zinc-50 dark:from-zinc-900 dark:to-zinc-950" />
        <div className="absolute top-[-10%] left-[-10%] h-[500px] w-[500px] rounded-full bg-red-500/10 dark:bg-red-600/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[500px] w-[500px] rounded-full bg-pink-500/10 dark:bg-pink-600/20 blur-[120px]" />

        {/* Subtle Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000005_1px,transparent_1px),linear-gradient(to_bottom,#00000005_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)]" />
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center p-6 md:p-12 w-full">
        <Card className="max-w-[448px] w-full bg-white/60 dark:bg-zinc-900/60 border border-black/5 dark:border-white/5 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.05)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.3)] hover:border-red-500/20 transition-all duration-500">
          <CardHeader className="text-center pb-6 border-b border-black/5 dark:border-white/5">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20 mb-4">
              <ShieldOff className="size-6 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
              Access Denied
            </CardTitle>
            <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 max-w-xs mx-auto">
              You do not have permission to manage this server&apos;s configuration. Access is restricted to configured administrator roles or guild owners.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="rounded-xl bg-black/5 dark:bg-black/40 border border-black/5 dark:border-white/5 p-4 text-xs font-mono text-zinc-500 dark:text-zinc-400 space-y-2">
              <div className="flex justify-between">
                <span className="text-zinc-400 dark:text-zinc-500">SERVER NAME:</span>
                <span className="text-zinc-800 dark:text-zinc-300 font-bold max-w-[200px] truncate text-right" title={guildName}>{guildName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400 dark:text-zinc-500">ACCESS ROLE:</span>
                <span className="text-red-600 dark:text-red-400 font-bold">UNAUTHORIZED</span>
              </div>
            </div>

            <Link href="/" className="block">
              <Button className="w-full h-11 bg-zinc-900 dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-100 font-bold shadow-[0_4px_20px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(255,255,255,0.1)] transition-all">
                <ArrowLeft className="size-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
