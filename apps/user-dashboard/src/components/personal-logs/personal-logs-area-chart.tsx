"use client";

import * as React from "react";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface DailySummaryItem {
  date: string;
  count: number;
  categories: Record<string, number>;
}

interface PersonalLogsAreaChartProps {
  analyticsData: DailySummaryItem[];
  timeframeDays: number;
  onTimeframeChange: (days: number) => void;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  loading?: boolean;
}

export function PersonalLogsAreaChart({
  analyticsData,
  timeframeDays,
  onTimeframeChange,
  selectedDate,
  onSelectDate,
  loading = false,
}: PersonalLogsAreaChartProps) {
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

  const totalLogs = React.useMemo(() => {
    return analyticsData.reduce((acc, d) => acc + d.count, 0);
  }, [analyticsData]);

  const highestDay = React.useMemo(() => {
    if (analyticsData.length === 0) return null;
    return [...analyticsData].sort((a, b) => b.count - a.count)[0];
  }, [analyticsData]);

  const avgLogs = React.useMemo(() => {
    return Math.round(totalLogs / Math.max(1, analyticsData.length));
  }, [totalLogs, analyticsData]);

  // Chart dimensions & coordinates
  const width = 800;
  const height = 220;
  const paddingLeft = 50;
  const paddingRight = 25;
  const paddingTop = 25;
  const paddingBottom = 35;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxVal = Math.max(10, ...analyticsData.map((d) => d.count));
  const minVal = 0;
  const range = maxVal - minVal || 1;

  const points = analyticsData.map((d, index) => {
    const x =
      analyticsData.length > 1
        ? paddingLeft + (index / (analyticsData.length - 1)) * chartWidth
        : paddingLeft + chartWidth / 2;
    const y = paddingTop + chartHeight - ((d.count - minVal) / range) * chartHeight;
    return { x, y, data: d, index };
  });

  const linePath = points.reduce((acc, p, i) => {
    return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, "");

  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`
      : "";

  const yTicks = [0, 0.33, 0.66, 1].map((ratio) => {
    const val = Math.round(minVal + ratio * range);
    const y = paddingTop + chartHeight - ratio * chartHeight;
    return { val, y };
  });

  const xTickStep = Math.max(1, Math.floor(analyticsData.length / 6));
  const xTicks = analyticsData.filter((_, idx) => idx % xTickStep === 0 || idx === analyticsData.length - 1);

  const activePoint = hoverIndex !== null ? points[hoverIndex] : null;

  // Selected date point index for persistent marker
  const selectedIndex = points.findIndex((p) => p.data.date === selectedDate);
  const selectedPoint = selectedIndex !== -1 ? points[selectedIndex] : null;

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
    <div className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xs p-5 space-y-4 shadow-sm">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-border/40 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Activity className="size-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Daily Log Volume Timeline</h2>
          </div>
        </div>

        {/* Header Right Controls & Quick Stats */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
          {/* Quick Stats */}
          <div className="hidden md:flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Highest:</span>
              <span className="font-bold text-primary">
                {highestDay ? `${highestDay.count.toLocaleString()} logs` : "0"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 border-l border-border/40 pl-3">
              <span className="text-muted-foreground">Daily Avg:</span>
              <span className="font-bold text-foreground">{avgLogs.toLocaleString()}</span>
            </div>
          </div>

          {/* Timeframe Selector Buttons */}
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/50 text-xs">
            {[7, 14, 30, 60, 90].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => onTimeframeChange(days)}
                className={cn(
                  "px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer",
                  timeframeDays === days
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* SVG Area Chart Container */}
      <div className="relative w-full select-none pt-2">
        {loading ? (
          <div className="h-48 flex items-center justify-center text-xs text-muted-foreground animate-pulse">
            Loading daily log volume chart...
          </div>
        ) : analyticsData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
            No personal log history found for the selected timeframe.
          </div>
        ) : (
          <div className="relative w-full">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-auto overflow-visible cursor-pointer"
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
              onClick={() => {
                if (activePoint) {
                  onSelectDate(activePoint.data.date);
                }
              }}
            >
              <defs>
                <linearGradient id="logsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="hsl(var(--primary))"
                    className="[stop-opacity:0.12] dark:[stop-opacity:0.32]"
                  />
                  <stop
                    offset="100%"
                    stopColor="hsl(var(--primary))"
                    className="[stop-opacity:0.0]"
                  />
                </linearGradient>
                <linearGradient id="logsLineGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="hsl(var(--primary))" />
                  <stop
                    offset="100%"
                    stopColor="hsl(var(--primary))"
                    className="[stop-opacity:0.75]"
                  />
                </linearGradient>
              </defs>

              {/* Y-Axis Grid Lines */}
              {yTicks.map((tick, i) => (
                <g key={i}>
                  <line
                    x1={paddingLeft}
                    y1={tick.y}
                    x2={width - paddingRight}
                    y2={tick.y}
                    stroke="currentColor"
                    className="text-border/30 dark:text-border/20"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  <text
                    x={paddingLeft - 8}
                    y={tick.y + 4}
                    textAnchor="end"
                    className="text-[10px] fill-muted-foreground font-mono font-medium"
                  >
                    {tick.val.toLocaleString()}
                  </text>
                </g>
              ))}

              {/* X-Axis Labels */}
              {xTicks.map((item, i) => {
                const idx = analyticsData.findIndex((t) => t.date === item.date);
                const p = points[idx];
                if (!p) return null;
                const isSelected = item.date === selectedDate;
                return (
                  <text
                    key={i}
                    x={p.x}
                    y={height - 8}
                    textAnchor="middle"
                    className={cn(
                      "text-[10px] font-mono transition-colors font-medium",
                      isSelected ? "fill-primary font-bold" : "fill-muted-foreground"
                    )}
                  >
                    {item.date.slice(5)}
                  </text>
                );
              })}

              {/* Area Fill */}
              <path d={areaPath} fill="url(#logsAreaGrad)" />

              {/* Main Line Path */}
              <path
                d={linePath}
                fill="none"
                stroke="url(#logsLineGrad)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Persistent Highlight Circle for Currently Selected Date */}
              {selectedPoint && (
                <g>
                  <line
                    x1={selectedPoint.x}
                    y1={paddingTop}
                    x2={selectedPoint.x}
                    y2={paddingTop + chartHeight}
                    stroke="hsl(var(--primary))"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    className="opacity-40 dark:opacity-60"
                  />
                  <circle
                    cx={selectedPoint.x}
                    cy={selectedPoint.y}
                    r="5"
                    className="fill-primary stroke-card dark:stroke-card stroke-2 shadow-xs"
                  />
                </g>
              )}

              {/* Active Hover Crosshair Line & Glowing Point */}
              {activePoint && (
                <g>
                  <line
                    x1={activePoint.x}
                    y1={paddingTop}
                    x2={activePoint.x}
                    y2={paddingTop + chartHeight}
                    stroke="hsl(var(--primary))"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                    className="opacity-50 dark:opacity-85"
                  />
                  <circle
                    cx={activePoint.x}
                    cy={activePoint.y}
                    r="6.5"
                    className="fill-primary stroke-card dark:stroke-card stroke-2 shadow-md"
                  />
                </g>
              )}
            </svg>

            {/* Floating Tooltip Box */}
            {activePoint && (
              <div
                className="absolute pointer-events-none transition-all duration-150 z-20"
                style={{
                  left: `${(activePoint.x / width) * 100}%`,
                  top: `${(activePoint.y / height) * 100}%`,
                  transform: `translate(${transformX}, ${transformY})`,
                }}
              >
                <div className="p-2.5 rounded-xl border border-border/80 bg-popover/95 text-popover-foreground backdrop-blur-md shadow-xl text-xs space-y-1.5 font-mono whitespace-nowrap min-w-[140px]">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground border-b border-border/40 pb-1">
                    <span>{activePoint.data.date}</span>
                    <span className="text-primary font-bold">{activePoint.data.count} logs</span>
                  </div>

                  {/* Top Categories Breakdown inside Tooltip */}
                  {Object.entries(activePoint.data.categories || {}).length > 0 ? (
                    <div className="space-y-0.5 pt-0.5 text-[10px]">
                      {Object.entries(activePoint.data.categories)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([cat, count]) => (
                          <div key={cat} className="flex items-center justify-between">
                            <span className="text-muted-foreground capitalize">{cat}:</span>
                            <span className="text-foreground font-semibold">{count}</span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground italic">No category data</div>
                  )}

                  <div className="text-[9px] text-muted-foreground border-t border-border/30 pt-1 text-center">
                    Click to view logs for this date
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
