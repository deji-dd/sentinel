"use client";

import React, { useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useIsMobile } from "@/hooks/use-mobile";

export function TravelChart({ data, timeframe }: { data: { timestamp: number; dailyYield: number }[], timeframe: "7d" | "30d" | "90d" | "all" }) {
  const isMobile = useIsMobile();

  const [now] = useState(() => Date.now());

  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return [];

    let filterMs = 0;

    if (timeframe === "7d") filterMs = 7 * 24 * 60 * 60 * 1000;
    else if (timeframe === "30d") filterMs = 30 * 24 * 60 * 60 * 1000;
    else if (timeframe === "90d") filterMs = 90 * 24 * 60 * 60 * 1000;

    return data.filter(d => filterMs === 0 || now - d.timestamp < filterMs).map(d => {
      const date = new Date(d.timestamp);
      return {
        ...d,
        dateStr: `${date.getUTCDate()}/${date.getUTCMonth() + 1}`,
        dailyYieldMillions: Number((d.dailyYield / 1000000).toFixed(2)),
      };
    });
  }, [data, now, timeframe]);

  if (filteredData.length === 0) {
    return (
      <div className="h-[250px] w-full relative flex items-center justify-center border border-dashed border-border rounded-none bg-background">
        <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-widest">Insufficient historical data to chart trajectory.</p>
      </div>
    );
  }

  return (
    <div className="h-[250px] w-full relative min-w-0">
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <AreaChart
          data={filteredData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorYield" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} opacity={0.5} />
          <XAxis
            dataKey="dateStr"
            stroke="var(--muted-foreground)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 10, fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={false}
            dy={10}
          />
          <YAxis
            yAxisId="left"
            hide={isMobile}
            stroke="var(--muted-foreground)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 10, fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `$${value}m`}
            domain={['auto', 'auto']}
            dx={-10}
          />
          <Tooltip
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '3 3', opacity: 0.5 }}
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                const isPositive = data.dailyYield >= 0;
                return (
                  <div className="bg-background border border-border p-3 shadow-xl">
                    <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-widest mb-2">{label}</p>
                    <div className="flex flex-col gap-1">
                      <p className={`text-sm font-mono tracking-widest flex justify-between gap-4 ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
                        <span>PROFIT:</span>
                        <span>{isPositive ? '+' : '-'}${Math.abs(data.dailyYieldMillions)}m</span>
                      </p>
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="dailyYieldMillions"
            stroke="#10b981"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorYield)"
            animationDuration={1000}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
