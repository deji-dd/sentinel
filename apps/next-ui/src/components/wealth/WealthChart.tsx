"use client";

import React from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { HistoricalPoint } from "@/hooks/use-wealth-ledger";

export function WealthChart({ data }: { data: HistoricalPoint[] }) {
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
      dailyYieldMillions: (d.dailyYield / 1000000).toFixed(2),
    };
  });

  return (
    <div className="h-[300px] w-full mt-6 relative min-w-0">
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <BarChart
          data={formattedData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
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
            stroke="rgba(255,255,255,0.2)" 
            tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `$${value}m`}
            domain={['auto', 'auto']}
            dx={-10}
          />
          <Tooltip 
            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                const isPositive = data.dailyYield >= 0;
                return (
                  <div className="bg-zinc-900/90 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-xl">
                    <p className="text-zinc-400 text-xs mb-1 font-medium">{label}</p>
                    <p className={`font-bold text-sm ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isPositive ? '+' : '-'}${Math.abs(data.dailyYieldMillions)}m
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="dailyYieldMillions" radius={[4, 4, 4, 4]} animationDuration={1500}>
            {formattedData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.dailyYield >= 0 ? '#10b981' : '#ef4444'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
