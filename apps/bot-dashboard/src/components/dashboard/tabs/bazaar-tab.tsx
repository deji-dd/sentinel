"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Bazaar tab subview displaying mug alerts and value threshold targets.
 */
export function BazaarTab() {
  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight">Bazaar Alerts</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Configure mug alerts and value threshold targets.</p>
      </div>

      <Card className="bg-white/50 dark:bg-black/40 border-black/5 dark:border-white/5 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            Mug & Trade Parameters
          </CardTitle>
          <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
            Notify roles when high value listings are posted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Value Threshold ($)</label>
              <Input placeholder="10,000,000" type="number" className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-zinc-800 dark:text-zinc-300 focus-visible:ring-yellow-500" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Alert Channel</label>
              <Input placeholder="#bazaar-watch" className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-zinc-800 dark:text-zinc-300 focus-visible:ring-yellow-500" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
