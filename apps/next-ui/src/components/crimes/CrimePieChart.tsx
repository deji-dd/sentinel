"use client";

import React, { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";
import { GlassCard } from "@/components/dashboard/GlassCard";
import { PieChart as PieChartIcon } from "lucide-react";

interface CrimeROI {
  crime_name: string;
  total_value: number;
  nerve_spent: number;
  profit_per_nerve: number;
}

interface CrimePieChartProps {
  data: CrimeROI[];
}

const COLORS = [
  "#6366f1", // indigo-500
  "#8b5cf6", // violet-500
  "#d946ef", // fuchsia-500
  "#ec4899", // pink-500
  "#f43f5e", // rose-500
  "#f97316", // orange-500
  "#eab308", // yellow-500
  "#84cc16", // lime-500
  "#22c55e", // green-500
  "#10b981", // emerald-500
  "#14b8a6", // teal-500
  "#0ea5e9", // sky-500
  "#3b82f6", // blue-500
];

export function CrimePieChart({ data }: CrimePieChartProps) {
  const chartData = useMemo(() => {
    // Filter out crimes with zero value
    const filtered = data.filter((item) => item.total_value > 0);
    // Sort by value descending
    filtered.sort((a, b) => b.total_value - a.total_value);
    
    // If there are many crimes, group the smaller ones into "Other"
    if (filtered.length > 8) {
      const top = filtered.slice(0, 7);
      const other = filtered.slice(7).reduce((acc, curr) => acc + curr.total_value, 0);
      if (other > 0) {
        top.push({
          crime_name: "Other Crimes",
          total_value: other,
          nerve_spent: 0,
          profit_per_nerve: 0,
        });
      }
      return top.map(item => ({ name: item.crime_name, value: item.total_value }));
    }

    return filtered.map(item => ({ name: item.crime_name, value: item.total_value }));
  }, [data]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border border-zinc-200 dark:border-white/10 p-4 rounded-xl shadow-xl">
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-1">{payload[0].name}</p>
          <p className="text-sm font-mono text-emerald-600 dark:text-emerald-400">
            {formatCurrency(payload[0].value)}
          </p>
        </div>
      );
    }
    return null;
  };

  if (chartData.length === 0) {
    return null;
  }

  return (
    <GlassCard className="glass-widget mb-8" tiltIntensity={0}>
      <div className="p-6">
        <h2 className="text-xl font-bold flex items-center gap-2 mb-6">
          <PieChartIcon className="text-fuchsia-400" /> Value Distribution
        </h2>
        
        <div className="w-full h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={100}
                outerRadius={140}
                paddingAngle={4}
                dataKey="value"
                stroke="none"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip content={<CustomTooltip />} />
              <Legend 
                verticalAlign="bottom" 
                height={36}
                formatter={(value) => <span className="text-zinc-600 dark:text-zinc-300 font-medium text-sm">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </GlassCard>
  );
}
