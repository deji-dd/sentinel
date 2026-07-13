"use client";

import React from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { HistoricalPoint } from "@/hooks/use-wealth-ledger";
import { useIsMobile } from "@/hooks/use-mobile";

export function WealthChart({ data }: { data: HistoricalPoint[] }) {
  const isMobile = useIsMobile();

  if (!data || data.length === 0) {
    return (
      <div className="h-[300px] w-full mt-6 relative flex items-center justify-center border border-dashed border-zinc-200 dark:border-white/5 rounded-xl bg-white/5">
        <p className="text-zinc-500 dark:text-zinc-400 text-sm font-medium">Insufficient historical data to chart trajectory.</p>
      </div>
    );
  }

  // Format timestamp to date string
  const formattedData = data.map(d => {
    const date = new Date(d.timestamp);
    return {
      ...d,
      dateStr: `${date.getUTCDate()}/${date.getUTCMonth() + 1}`,
      dailyYieldMillions: Number((d.dailyYield / 1000000).toFixed(2)),
      liquidCashMillions: Number(((d.liquidCash || 0) / 1000000).toFixed(2)),
    };
  });

  return (
    <div className="h-[300px] w-full mt-6 relative min-w-0">
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <AreaChart
          data={formattedData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorLiquidity" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorYield" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="dateStr"
            stroke="rgba(255,255,255,0.2)"
            tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            dy={10}
          />
          <YAxis
            yAxisId="left"
            hide={isMobile}
            stroke="rgba(255,255,255,0.2)"
            tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `$${value}m`}
            domain={['auto', 'auto']}
            dx={-10}
          />
          <YAxis
            yAxisId="right"
            hide={isMobile}
            orientation="right"
            stroke="rgba(255,255,255,0.2)"
            tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `$${value}m`}
            domain={['auto', 'auto']}
            dx={10}
          />
          <Tooltip
            cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '3 3' }}
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                const isPositive = data.dailyYield >= 0;
                return (
                  <div className="bg-zinc-900/90 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-xl">
                    <p className="text-zinc-400 text-xs mb-2 font-medium">{label}</p>
                    <div className="flex flex-col gap-1">
                      <p className="text-sm text-blue-400 font-medium flex justify-between gap-4">
                        <span>Liquidity:</span>
                        <span>${data.liquidCashMillions}m</span>
                      </p>
                      <p className={`text-sm font-bold flex justify-between gap-4 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                        <span>Yield:</span>
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
            dataKey="liquidCashMillions"
            stroke="#3b82f6"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorLiquidity)"
            animationDuration={1500}
          />
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="dailyYieldMillions"
            stroke="#10b981"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorYield)"
            animationDuration={1500}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
