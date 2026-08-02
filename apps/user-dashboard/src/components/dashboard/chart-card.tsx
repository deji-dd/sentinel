"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { BarChart2, Activity, Maximize2, MoreHorizontal } from "lucide-react";

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  className?: string;
}

export function ChartCard({ title, subtitle, className }: ChartCardProps) {
  const [timeframe, setTimeframe] = React.useState<"1H" | "24H" | "7D" | "30D">("24H");

  return (
    <div className={cn("flex flex-col p-4 bg-card rounded-xl border border-border/60 shadow-xs", className)}>
      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-cyan-500" />
            <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
          </div>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="flex items-center bg-muted/40 p-0.5 rounded-lg border border-border/40 text-xs">
            {(["1H", "24H", "7D", "30D"] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={cn(
                  "px-2 py-0.5 rounded-md font-mono text-[11px] transition-all",
                  timeframe === tf
                    ? "bg-background text-foreground font-semibold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tf}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </div>
      </div>

      {/* SVG Analytics Visualization */}
      <div className="relative w-full h-48 sm:h-56 mt-2 bg-muted/10 rounded-lg p-2 border border-border/40 flex items-end">
        {/* Background Grid Lines */}
        <div className="absolute inset-0 flex flex-col justify-between p-4 pointer-events-none opacity-20">
          <div className="border-b border-border w-full" />
          <div className="border-b border-border w-full" />
          <div className="border-b border-border w-full" />
          <div className="border-b border-border w-full" />
        </div>

        {/* Dynamic Chart SVG Lines & Areas */}
        <svg className="w-full h-full overflow-visible" viewBox="0 0 500 150" preserveAspectRatio="none">
          <defs>
            <linearGradient id="cyanGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="indigoGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Area 1 - Cyan */}
          <path
            d="M0 120 Q 60 70, 120 90 T 240 40 T 360 80 T 500 20 L 500 150 L 0 150 Z"
            fill="url(#cyanGradient)"
          />
          {/* Stroke 1 */}
          <path
            d="M0 120 Q 60 70, 120 90 T 240 40 T 360 80 T 500 20"
            fill="none"
            stroke="#06b6d4"
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Area 2 - Indigo */}
          <path
            d="M0 135 Q 80 100, 160 110 T 320 70 T 420 95 T 500 50 L 500 150 L 0 150 Z"
            fill="url(#indigoGradient)"
          />
          {/* Stroke 2 */}
          <path
            d="M0 135 Q 80 100, 160 110 T 320 70 T 420 95 T 500 50"
            fill="none"
            stroke="#6366f1"
            strokeWidth="2"
            strokeDasharray="4 4"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Chart Legend Footer */}
      <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-3 border-t border-border/40 text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-cyan-500" />
            <span className="font-medium text-foreground">API Throughput (req/s)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-indigo-500" />
            <span className="font-medium text-foreground">Database Write IOPS</span>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span>Peak: <strong className="text-foreground font-semibold">14.2k req/s</strong></span>
          <span>•</span>
          <span>Avg Latency: <strong className="text-foreground font-semibold">4.2ms</strong></span>
        </div>
      </div>
    </div>
  );
}
