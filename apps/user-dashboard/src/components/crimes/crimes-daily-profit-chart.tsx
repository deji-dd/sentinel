"use client";

import * as React from "react";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface DailyTimelineItem {
  date: string;
  count: number;
  profit: number;
  nerve: number;
  profitPerNerve: number;
}

interface CrimesDailyProfitChartProps {
  timeline: DailyTimelineItem[];
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

export function CrimesDailyProfitChart({ timeline }: CrimesDailyProfitChartProps) {
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

  if (!timeline || timeline.length === 0) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card p-6 text-center text-xs text-muted-foreground italic">
        No daily profit timeline data available.
      </div>
    );
  }

  // Calculate metrics
  const totalProfit = timeline.reduce((acc, item) => acc + item.profit, 0);
  const highestProfitDay = [...timeline].sort((a, b) => b.profit - a.profit)[0];
  const avgProfit = Math.round(totalProfit / Math.max(1, timeline.length));

  // Chart dimensions & scaling
  const width = 800;
  const height = 220;
  const paddingLeft = 65;
  const paddingRight = 25;
  const paddingTop = 25;
  const paddingBottom = 35;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxVal = Math.max(100, ...timeline.map((d) => d.profit));
  const minVal = Math.min(0, ...timeline.map((d) => d.profit));
  const range = maxVal - minVal || 1;

  // Map points to (x, y) coordinates
  const points = timeline.map((d, index) => {
    const x =
      timeline.length > 1
        ? paddingLeft + (index / (timeline.length - 1)) * chartWidth
        : paddingLeft + chartWidth / 2;
    const y = paddingTop + chartHeight - ((d.profit - minVal) / range) * chartHeight;
    return { x, y, data: d, index };
  });

  // Construct SVG path string for line
  const linePath = points.reduce((acc, p, i) => {
    return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, "");

  // Construct SVG path string for area fill
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`
      : "";

  // Y-axis grid ticks (4 intervals)
  const yTicks = [0, 0.33, 0.66, 1].map((ratio) => {
    const val = minVal + ratio * range;
    const y = paddingTop + chartHeight - ratio * chartHeight;
    return { val, y };
  });

  // X-axis label ticks (show up to 7 dates)
  const xTickStep = Math.max(1, Math.floor(timeline.length / 6));
  const xTicks = timeline.filter((_, idx) => idx % xTickStep === 0 || idx === timeline.length - 1);

  const activePoint = hoverIndex !== null ? points[hoverIndex] : null;

  // Dynamic tooltip boundary clamping & alignment
  let transformX = "-50%";
  let transformY = "-120%";

  if (activePoint) {
    const xRatio = activePoint.x / width;
    const yRatio = activePoint.y / height;

    if (xRatio < 0.2) {
      transformX = "0%";
    } else if (xRatio > 0.8) {
      transformX = "-100%";
    }

    if (yRatio < 0.35) {
      transformY = "25%";
    }
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5 space-y-4 shadow-sm">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/40 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
            <TrendingUp className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Daily Total Profit Timeline</h3>
          </div>
        </div>

        {/* Quick Stats Summary */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Highest Day:</span>
            <span className="font-bold text-emerald-400">
              {highestProfitDay ? formatMoney(highestProfitDay.profit) : "$0"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 border-l border-border/40 pl-4">
            <span className="text-muted-foreground">Daily Avg:</span>
            <span className="font-bold text-foreground">{formatMoney(avgProfit)}</span>
          </div>
        </div>
      </div>

      {/* SVG Chart Container */}
      <div className="relative w-full select-none">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible"
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const mouseX = ((e.clientX - rect.left) / rect.width) * width;
            let closestIdx = 0;
            let minDiff = Infinity;
            points.forEach((p, i) => {
              const diff = Math.abs(p.x - mouseX);
              if (diff < minDiff) {
                minDiff = diff;
                closestIdx = i;
              }
            });
            setHoverIndex(closestIdx);
          }}
        >
          <defs>
            <linearGradient id="profitAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="#10b981"
                className="[stop-opacity:0.12] dark:[stop-opacity:0.32]"
              />
              <stop
                offset="100%"
                stopColor="#10b981"
                className="[stop-opacity:0.0]"
              />
            </linearGradient>
            <linearGradient id="profitLineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>

          {/* Grid Lines */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={paddingLeft}
                y1={tick.y}
                x2={width - paddingRight}
                y2={tick.y}
                stroke="currentColor"
                className="text-border/40"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              <text
                x={paddingLeft - 8}
                y={tick.y + 4}
                textAnchor="end"
                className="text-[10px] fill-muted-foreground font-mono"
              >
                {formatMoney(tick.val)}
              </text>
            </g>
          ))}

          {/* X Axis Labels */}
          {xTicks.map((item, i) => {
            const idx = timeline.findIndex((t) => t.date === item.date);
            const p = points[idx];
            if (!p) return null;
            return (
              <text
                key={i}
                x={p.x}
                y={height - 8}
                textAnchor="middle"
                className="text-[10px] fill-muted-foreground font-mono"
              >
                {item.date.slice(5)}
              </text>
            );
          })}

          {/* Area Fill */}
          <path d={areaPath} fill="url(#profitAreaGrad)" />

          {/* Main Line Path */}
          <path
            d={linePath}
            fill="none"
            stroke="url(#profitLineGrad)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Active Hover Guide Line & Indicator Dot */}
          {activePoint && (
            <g>
              <line
                x1={activePoint.x}
                y1={paddingTop}
                x2={activePoint.x}
                y2={paddingTop + chartHeight}
                stroke="#10b981"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                opacity="0.8"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="6"
                className="fill-emerald-400 stroke-background stroke-2 shadow-lg"
              />
            </g>
          )}
        </svg>

        {/* Floating Tooltip Box with Boundary Clamping */}
        {activePoint && (
          <div
            className="absolute pointer-events-none transition-all duration-150 z-20"
            style={{
              left: `${(activePoint.x / width) * 100}%`,
              top: `${(activePoint.y / height) * 100}%`,
              transform: `translate(${transformX}, ${transformY})`,
            }}
          >
            <div className="p-2.5 rounded-xl border border-emerald-500/40 bg-card/95 backdrop-blur-md shadow-xl text-xs space-y-1 font-mono whitespace-nowrap min-w-[130px]">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground border-b border-border/40 pb-1">
                <span>{activePoint.data.date}</span>
                <span className="text-[10px]">{activePoint.data.count} crimes</span>
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-muted-foreground text-[11px]">Profit:</span>
                <span
                  className={cn(
                    "font-bold",
                    activePoint.data.profit < 0 ? "text-rose-400" : "text-emerald-400"
                  )}
                >
                  {formatMoney(activePoint.data.profit)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">Nerve:</span>
                <span className="text-cyan-400 font-semibold">
                  {activePoint.data.nerve} N (${activePoint.data.profitPerNerve}/N)
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
