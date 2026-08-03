"use client";

import * as React from "react";
import { DollarSign, Zap, Trophy, Award, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface CrimesOverallStats {
  totalProfit: number;
  totalNerve: number;
  totalLogs: number;
  avgDailyProfit: number;
  profitPerNerve: number;
  uncategorizedCount: number;
}

export interface TopCrimeItem {
  crimeId: number;
  crimeName: string;
  totalProfit: number;
  totalNerve: number;
  count: number;
  profitPerNerve: number;
  profitPercentage?: number;
}

interface CrimesStatCardsProps {
  overall: CrimesOverallStats;
  mostProfitablePerNerve: TopCrimeItem | null;
  mostProfitableRaw: TopCrimeItem | null;
  days: number;
}

function formatMoney(amount: number): string {
  const isNegative = amount < 0;
  const absVal = Math.abs(amount);
  let formatted = "";
  if (absVal >= 1_000_000_000) {
    formatted = `$${(absVal / 1_000_000_000).toFixed(2)}B`;
  } else if (absVal >= 1_000_000) {
    formatted = `$${(absVal / 1_000_000).toFixed(2)}M`;
  } else if (absVal >= 1_000) {
    formatted = `$${(absVal / 1_000).toFixed(1)}k`;
  } else {
    formatted = `$${absVal.toLocaleString()}`;
  }
  return isNegative ? `-${formatted}` : formatted;
}

export function CrimesStatCards({
  overall,
  mostProfitablePerNerve,
  mostProfitableRaw,
  days,
}: CrimesStatCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Avg Daily Profit Card */}
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 dark:bg-emerald-950/20 p-5 flex flex-col justify-between relative overflow-hidden group hover:border-emerald-500/40 transition-all shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400/90">
            Avg Daily Profit
          </span>
          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
            <DollarSign className="size-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-emerald-400">
            {formatMoney(overall.avgDailyProfit)}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Total: {formatMoney(overall.totalProfit)}</span>
            <span className="font-mono text-emerald-400/80">
              {days === 0 ? "All Time" : `${days}d window`}
            </span>
          </div>
        </div>
      </div>

      {/* Profit per Nerve Card */}
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/10 dark:bg-cyan-950/20 p-5 flex flex-col justify-between relative overflow-hidden group hover:border-cyan-500/40 transition-all shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400/90">
            Profit Per Nerve
          </span>
          <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
            <Zap className="size-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-cyan-400">
            ${overall.profitPerNerve.toLocaleString()}
            <span className="text-xs font-normal text-muted-foreground ml-1">/ N</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Nerve: {overall.totalNerve.toLocaleString()}</span>
            <span className="font-mono text-cyan-400/80">{overall.totalLogs} logs</span>
          </div>
        </div>
      </div>

      {/* Most Profitable (Per Nerve) */}
      <div className="rounded-2xl border border-amber-500/20 bg-amber-950/10 dark:bg-amber-950/20 p-5 flex flex-col justify-between relative overflow-hidden group hover:border-amber-500/40 transition-all shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-400/90">
            Top Nerve Efficiency
          </span>
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
            <Trophy className="size-4" />
          </div>
        </div>
        <div className="mt-3">
          {mostProfitablePerNerve ? (
            <>
              <div className="text-lg font-bold text-foreground truncate" title={mostProfitablePerNerve.crimeName}>
                {mostProfitablePerNerve.crimeName}
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xl font-black font-mono text-amber-400">
                  ${mostProfitablePerNerve.profitPerNerve.toLocaleString()}
                  <span className="text-xs font-normal text-muted-foreground ml-0.5">/ N</span>
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  {formatMoney(mostProfitablePerNerve.totalProfit)}
                </span>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground italic">No crime data</div>
          )}
        </div>
      </div>

      {/* Most Profitable (Raw Total) */}
      <div className="rounded-2xl border border-indigo-500/20 bg-indigo-950/10 dark:bg-indigo-950/20 p-5 flex flex-col justify-between relative overflow-hidden group hover:border-indigo-500/40 transition-all shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400/90">
            Top Raw Profit
          </span>
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
            <Award className="size-4" />
          </div>
        </div>
        <div className="mt-3">
          {mostProfitableRaw ? (
            <>
              <div className="text-lg font-bold text-foreground truncate" title={mostProfitableRaw.crimeName}>
                {mostProfitableRaw.crimeName}
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xl font-black font-mono text-indigo-400">
                  {formatMoney(mostProfitableRaw.totalProfit)}
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  {mostProfitableRaw.count} executions
                </span>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground italic">No crime data</div>
          )}
        </div>
      </div>
    </div>
  );
}
