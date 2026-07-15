"use client";

import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { BarChart3 } from "lucide-react";

interface CrimeROI {
  crime_name: string;
  total_value: number;
  nerve_spent: number;
  profit_per_nerve: number;
}

interface CrimeBarChartProps {
  data: CrimeROI[];
}

const COLORS = [
  "#ffffff",
  "#e5e5e5",
  "#a3a3a3",
  "#737373",
  "#525252",
  "#404040",
  "#262626",
];

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-black border border-neutral-900 p-4 shadow-2xl">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white mb-1">
          {payload[0].payload.name}
        </p>
        <p className="text-xs font-mono text-neutral-400">
          {formatCurrency(payload[0].value)}
        </p>
      </div>
    );
  }
  return null;
};

export function CrimeBarChart({ data }: CrimeBarChartProps) {
  const chartData = useMemo(() => {
    // Filter out crimes with zero value
    const filtered = data.filter((item) => item.total_value > 0);
    // Sort by value descending
    filtered.sort((a, b) => b.total_value - a.total_value);

    // Group small ones into "Other"
    if (filtered.length > 8) {
      const top = filtered.slice(0, 7);
      const other = filtered.slice(7).reduce(
        (acc, curr) => acc + curr.total_value,
        0
      );
      if (other > 0) {
        top.push({
          crime_name: "Other Crimes",
          total_value: other,
          nerve_spent: 0,
          profit_per_nerve: 0,
        });
      }
      return top.map((item) => ({
        name: item.crime_name,
        value: item.total_value,
      }));
    }

    return filtered.map((item) => ({
      name: item.crime_name,
      value: item.total_value,
    }));
  }, [data]);

  if (chartData.length === 0) {
    return null;
  }

  return (
    <div className="border border-neutral-900 bg-black p-6 mb-8">
      <div className="flex items-center gap-2 font-mono text-white text-[10px] uppercase tracking-[0.2em] mb-6">
        <BarChart3 size={16} /> VALUE_DISTRIBUTION
      </div>
      <div className="-mx-6 md:mx-0 w-[calc(100%+3rem)] md:w-full h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
          >
            <XAxis type="number" hide />
            <YAxis
              dataKey="name"
              type="category"
              axisLine={false}
              tickLine={false}
              tick={{
                fill: "#737373",
                fontSize: 10,
                fontFamily: "monospace",
              }}
              width={120}
            />
            <RechartsTooltip cursor={{ fill: "#171717" }} content={<CustomTooltip />} />
            <Bar dataKey="value" radius={[0, 2, 2, 0]} barSize={24}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
