"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon?: React.ReactNode;
  badgeText?: string;
  accentColor?: "cyan" | "emerald" | "indigo" | "amber" | "rose";
  trendData?: number[];
  className?: string;
}

const accentMap = {
  cyan: "border-l-cyan-500/80 text-cyan-500 bg-cyan-500/10",
  emerald: "border-l-emerald-500/80 text-emerald-500 bg-emerald-500/10",
  indigo: "border-l-indigo-500/80 text-indigo-500 bg-indigo-500/10",
  amber: "border-l-amber-500/80 text-amber-500 bg-amber-500/10",
  rose: "border-l-rose-500/80 text-rose-500 bg-rose-500/10",
};

export function MetricCard({
  title,
  value,
  subtitle,
  change,
  changeType = "neutral",
  icon,
  badgeText,
  accentColor = "cyan",
  trendData = [40, 65, 45, 80, 55, 90, 75, 95],
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "group relative flex flex-col justify-between p-4 bg-card rounded-xl border border-border/60 shadow-xs hover:border-border transition-all duration-200 border-l-4",
        accentMap[accentColor].split(" ")[0],
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {icon && (
            <div className={cn("p-1.5 rounded-md", accentMap[accentColor].split(" ").slice(1).join(" "))}>
              {icon}
            </div>
          )}
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
        </div>

        {badgeText && (
          <span className="px-2 py-0.5 text-[10px] font-mono font-medium rounded-full bg-secondary text-secondary-foreground border border-border/40">
            {badgeText}
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2 mt-1">
        <div>
          <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
            {value}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>

        {/* Mini Sparkline Bar Chart Visual */}
        {trendData && trendData.length > 0 && (
          <div className="flex items-end gap-1 h-8 px-1">
            {trendData.map((val, idx) => (
              <div
                key={idx}
                style={{ height: `${val}%` }}
                className={cn(
                  "w-1 rounded-xs transition-all duration-300 opacity-60 group-hover:opacity-100",
                  changeType === "positive"
                    ? "bg-emerald-500"
                    : changeType === "negative"
                    ? "bg-rose-500"
                    : "bg-primary"
                )}
              />
            ))}
          </div>
        )}
      </div>

      {change && (
        <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-border/40 text-xs">
          {changeType === "positive" && (
            <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400 font-medium">
              <TrendingUp className="size-3.5 mr-0.5" />
              {change}
            </span>
          )}
          {changeType === "negative" && (
            <span className="inline-flex items-center text-rose-600 dark:text-rose-400 font-medium">
              <TrendingDown className="size-3.5 mr-0.5" />
              {change}
            </span>
          )}
          {changeType === "neutral" && (
            <span className="inline-flex items-center text-muted-foreground font-medium">
              <Minus className="size-3.5 mr-0.5" />
              {change}
            </span>
          )}
          <span className="text-muted-foreground/70 text-[11px]">vs previous window</span>
        </div>
      )}
    </div>
  );
}
