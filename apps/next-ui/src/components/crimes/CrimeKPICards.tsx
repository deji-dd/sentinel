"use client";

import React, { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/wealth/AnimatedNumber";
import { Target, Zap, Activity } from "lucide-react";

interface CrimeROI {
  crime_name: string;
  total_value: number;
  nerve_spent: number;
  profit_per_nerve: number;
}

interface CrimeKPICardsProps {
  data: CrimeROI[];
}

export function CrimeKPICards({ data }: CrimeKPICardsProps) {
  const { totalValue, totalNerve, avgValuePerNerve } = useMemo(() => {
    let tv = 0;
    let tn = 0;
    for (const item of data) {
      tv += item.total_value;
      tn += item.nerve_spent;
    }
    const avg = tn > 0 ? tv / tn : 0;
    return { totalValue: tv, totalNerve: tn, avgValuePerNerve: avg };
  }, [data]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      {/* Total Value */}
      <Card>
        <CardContent className="p-6 flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-4 text-emerald-600 dark:text-emerald-400">
            <div className="p-2 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-lg">
              <Target size={20} />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Total Value Earned</h3>
          </div>
          <div className="text-3xl font-black font-mono text-zinc-900 dark:text-zinc-100">
            <AnimatedNumber value={totalValue} prefix="$" />
          </div>
        </CardContent>
      </Card>

      {/* Total Nerve */}
      <Card>
        <CardContent className="p-6 flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-4 text-indigo-600 dark:text-indigo-400">
            <div className="p-2 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-lg">
              <Zap size={20} />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Total Nerve Spent</h3>
          </div>
          <div className="text-3xl font-black font-mono text-zinc-900 dark:text-zinc-100">
            <AnimatedNumber value={totalNerve} />
          </div>
        </CardContent>
      </Card>

      {/* Avg Value/Nerve */}
      <Card>
        <CardContent className="p-6 flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-4 text-amber-600 dark:text-amber-400">
            <div className="p-2 bg-amber-500/10 dark:bg-amber-500/20 rounded-lg">
              <Activity size={20} />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Avg Value / Nerve</h3>
          </div>
          <div className="text-3xl font-black font-mono text-zinc-900 dark:text-zinc-100">
            <AnimatedNumber value={avgValuePerNerve} prefix="$" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
