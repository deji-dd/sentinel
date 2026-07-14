"use client";

import React, { useMemo } from "react";
import { AnimatedNumber } from "@/components/wealth/AnimatedNumber";
import { Target, Zap, Activity, Star } from "lucide-react";

interface CrimeROI {
  crime_name: string;
  total_value: number;
  nerve_spent: number;
  profit_per_nerve: number;
}

interface CrimeKPICardsProps {
  data: CrimeROI[];
}

export function CrimeKPICards({ data }: CrimeKPICardsProps) {
  const { totalValue, totalNerve, avgValuePerNerve } = useMemo(() => {
    let tv = 0;
    let tn = 0;
    for (const item of data) {
      tv += item.total_value;
      tn += item.nerve_spent;
    }
    const avg = tn > 0 ? tv / tn : 0;
    return { totalValue: tv, totalNerve: tn, avgValuePerNerve: avg };
  }, [data]);

  const recommended = data.length > 0 ? data[0] : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      {/* Total Value */}
      <div className="border border-neutral-900 bg-black p-6 flex flex-col justify-between">
        <div className="flex items-center gap-3 mb-6 text-white">
          <div className="p-2 border border-neutral-800">
            <Target size={16} />
          </div>
          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-500">Total Value Earned</h3>
        </div>
        <div className="text-2xl font-mono text-white">
          <AnimatedNumber value={totalValue} prefix="$" />
        </div>
      </div>

      {/* Total Nerve */}
      <div className="border border-neutral-900 bg-black p-6 flex flex-col justify-between">
        <div className="flex items-center gap-3 mb-6 text-white">
          <div className="p-2 border border-neutral-800">
            <Zap size={16} />
          </div>
          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-500">Total Nerve Spent</h3>
        </div>
        <div className="text-2xl font-mono text-white">
          <AnimatedNumber value={totalNerve} />
        </div>
      </div>

      {/* Avg Value/Nerve */}
      <div className="border border-neutral-900 bg-black p-6 flex flex-col justify-between">
        <div className="flex items-center gap-3 mb-6 text-white">
          <div className="p-2 border border-neutral-800">
            <Activity size={16} />
          </div>
          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-500">Avg Value / Nerve</h3>
        </div>
        <div className="text-2xl font-mono text-white">
          <AnimatedNumber value={avgValuePerNerve} prefix="$" />
        </div>
      </div>
      {/* Recommended Crime */}
      <div className="border border-neutral-900 bg-black p-6 flex flex-col justify-between">
        <div className="flex items-center gap-3 mb-6 text-white">
          <div className="p-2 border border-neutral-800">
            <Star size={16} />
          </div>
          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-500">Recommended</h3>
        </div>
        <div>
          <div className="text-xl font-mono text-white break-words">
            {recommended ? recommended.crime_name : "N/A"}
          </div>
          {recommended && (
            <div className="text-xs font-mono text-neutral-500 mt-2 uppercase tracking-widest">
              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(recommended.profit_per_nerve)} / N
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
