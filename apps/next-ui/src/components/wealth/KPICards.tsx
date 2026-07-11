"use client";

import React, { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { GlassCard } from "@/components/dashboard/GlassCard";
import { AnimatedNumber } from "./AnimatedNumber";
import { Wallet, Briefcase, TrendingUp } from "lucide-react";

interface KPICardsProps {
  liquidCash: number;
  dailyYield: number;
}

export function KPICards({ liquidCash, dailyYield }: KPICardsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    gsap.from(".kpi-card", {
      y: 30,
      opacity: 0,
      duration: 0.8,
      stagger: 0.1,
      ease: "power3.out",
      clearProps: "all"
    });
  }, { scope: containerRef, dependencies: [] });

  return (
    <div ref={containerRef} className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      <GlassCard className="kpi-card flex flex-col justify-between" tiltIntensity={5}>
        <div className="flex items-center gap-3 mb-4 text-emerald-600 dark:text-emerald-400">
          <div className="p-2 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-lg">
            <Wallet size={20} />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Liquid Cash</h3>
        </div>
        <div className="text-3xl font-black font-mono text-zinc-900 dark:text-zinc-100">
          <AnimatedNumber value={liquidCash} prefix="$" />
        </div>
      </GlassCard>


      <GlassCard className="kpi-card flex flex-col justify-between" tiltIntensity={5}>
        <div className="flex items-center gap-3 mb-4 text-violet-600 dark:text-violet-400">
          <div className="p-2 bg-violet-500/10 dark:bg-violet-500/20 rounded-lg">
            <TrendingUp size={20} />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">24H Yield</h3>
        </div>
        <div className={`text-3xl font-black font-mono ${dailyYield >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          <AnimatedNumber value={Math.abs(dailyYield)} prefix={dailyYield >= 0 ? '+$' : '-$'} />
        </div>
      </GlassCard>
    </div>
  );
}
