"use client";

import * as React from "react";
import { TopCrimeItem } from "./crimes-stat-cards";
import { cn } from "@/lib/utils/cn";
import { PieChart, BarChart3, Zap, DollarSign } from "lucide-react";

interface CrimesDistributionChartsProps {
  distributionByProfit: TopCrimeItem[];
  distributionByEfficiency: TopCrimeItem[];
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

export function CrimesDistributionCharts({
  distributionByProfit,
  distributionByEfficiency,
}: CrimesDistributionChartsProps) {
  // Filter out items with 0 count to show clean active distributions
  const activeProfitList = distributionByProfit.filter((item) => item.count > 0);
  const activeEfficiencyList = distributionByEfficiency.filter((item) => item.count > 0);

  // Maximum values for scaling progress bars
  const maxProfit = Math.max(1, ...activeProfitList.map((item) => Math.abs(item.totalProfit)));
  const maxEfficiency = Math.max(1, ...activeEfficiencyList.map((item) => item.profitPerNerve));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Distribution of Profit by Crime */}
      <div className="rounded-2xl border border-border/70 bg-card p-5 flex flex-col space-y-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <DollarSign className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Distribution of Profit by Crime</h3>
            </div>
          </div>
        </div>

        <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
          {activeProfitList.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-8 text-center">
              No crime profits recorded in this period.
            </div>
          ) : (
            activeProfitList.map((item) => {
              const widthPct = Math.min(100, Math.max(4, (Math.abs(item.totalProfit) / maxProfit) * 100));
              const isNegative = item.totalProfit < 0;

              return (
                <div key={item.crimeId} className="space-y-1 group">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="flex items-center gap-1.5 truncate max-w-[200px]">
                      <span className={cn(
                        "size-2 rounded-full shrink-0",
                        item.crimeId === 0 ? "bg-rose-500" : "bg-emerald-500"
                      )} />
                      <span className="text-foreground truncate">{item.crimeName}</span>
                    </span>
                    <div className="flex items-center gap-3 shrink-0 font-mono">
                      <span className="text-muted-foreground text-[11px]">
                        {item.profitPercentage}%
                      </span>
                      <span className={cn(
                        "font-semibold",
                        isNegative ? "text-rose-400" : "text-emerald-400"
                      )}>
                        {formatMoney(item.totalProfit)}
                      </span>
                    </div>
                  </div>

                  <div className="h-2 w-full bg-muted/60 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        isNegative
                          ? "bg-rose-500/80"
                          : item.crimeId === 0
                            ? "bg-amber-500/80"
                            : "bg-emerald-500"
                      )}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Distribution of Profit Per Nerve by Crime */}
      <div className="rounded-2xl border border-border/70 bg-card p-5 flex flex-col space-y-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <Zap className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Profit Per Nerve by Crime</h3>
            </div>
          </div>
        </div>

        <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
          {activeEfficiencyList.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-8 text-center">
              No nerve efficiency data recorded in this period.
            </div>
          ) : (
            activeEfficiencyList.map((item) => {
              const widthPct = Math.min(100, Math.max(4, (item.profitPerNerve / maxEfficiency) * 100));

              return (
                <div key={item.crimeId} className="space-y-1 group">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="flex items-center gap-1.5 truncate max-w-[200px]">
                      <span className="size-2 rounded-full bg-cyan-400 shrink-0" />
                      <span className="text-foreground truncate">{item.crimeName}</span>
                    </span>
                    <div className="flex items-center gap-3 shrink-0 font-mono">
                      <span className="text-muted-foreground text-[11px]">
                        {item.totalNerve.toLocaleString()} N
                      </span>
                      <span className="font-semibold text-cyan-400">
                        ${item.profitPerNerve.toLocaleString()}
                        <span className="text-[10px] text-muted-foreground font-normal">/N</span>
                      </span>
                    </div>
                  </div>

                  <div className="h-2 w-full bg-muted/60 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-cyan-400 transition-all duration-500"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
