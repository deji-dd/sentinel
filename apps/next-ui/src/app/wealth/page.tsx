"use client";

import React, { useEffect, useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { DashboardLayout } from "@/components/dashboard-layout";
import { useWealthLedger } from "@/hooks/use-wealth-ledger";
import { KPICards } from "@/components/wealth/KPICards";
import { WealthChart } from "@/components/wealth/WealthChart";
import { LedgerTable } from "@/components/wealth/LedgerTable";
import { ActionQueueSheet } from "@/components/wealth/ActionQueueSheet";
import { GlassCard } from "@/components/dashboard/GlassCard";
import { Activity, List } from "lucide-react";
import { useSync } from "@/hooks/use-sync";

export default function WealthPage() {
  const { data, loading, refetch } = useWealthLedger();
  const containerRef = useRef<HTMLDivElement>(null);
  const { setSyncOptions, setLastSyncedText } = useSync();

  useEffect(() => {
    setSyncOptions([
      {
        label: "Sync Wealth Ledger",
        action: async () => {
          refetch();
        },
      },
    ]);
    if (data) {
      setLastSyncedText(`Last synced at ${new Date().toLocaleTimeString()}`);
    }
    return () => {
      setSyncOptions(null);
      setLastSyncedText("");
    };
  }, [setSyncOptions, setLastSyncedText, refetch, data]);

  useGSAP(() => {
    if (loading || !data) return;

    gsap.from(".header-reveal", {
      y: -20,
      opacity: 0,
      duration: 1,
      ease: "power3.out",
      stagger: 0.1,
      clearProps: "all"
    });

    gsap.from(".section-reveal", {
      y: 40,
      opacity: 0,
      duration: 1.2,
      ease: "power3.out",
      stagger: 0.2,
      delay: 0.2,
      clearProps: "all"
    });
  }, { scope: containerRef, dependencies: [loading] });

  if (loading || !data) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="flex flex-col items-center gap-4 text-zinc-500">
            <Activity className="w-8 h-8 animate-pulse text-indigo-500" />
            <p className="animate-pulse">Loading Wealth Matrix...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div ref={containerRef} className="pb-24">
        <div className="flex items-center justify-between mb-8 header-reveal">
          <div>
            <h1 className="text-4xl font-black tracking-tighter text-zinc-900 dark:text-zinc-100 mb-1">Wealth & Ledger</h1>
            <p className="text-zinc-500 dark:text-zinc-400">Total Net Worth and Asset Matrix Visualization</p>
          </div>
          <div>
            <ActionQueueSheet items={data.actionQueue} />
          </div>
        </div>

        <div className="section-reveal">
          <KPICards
            liquidCash={data.liquidCash}
            dailyYield={data.dailyYield}
          />
        </div>

        <div className="section-reveal mb-8">
          <GlassCard className="pt-6" tiltIntensity={2}>
            <div className="flex items-center gap-2 mb-2 px-2">
              <Activity className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">30-Day Net Worth Trajectory</h2>
            </div>
            <WealthChart data={data.historical} />
          </GlassCard>
        </div>

        <div className="section-reveal">
          <GlassCard tiltIntensity={0} className="p-0 overflow-hidden">
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <List className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Recent Transactions</h2>
              </div>
            </div>
            <div className="md:p-6">
              <LedgerTable data={data.recentTransactions} />
            </div>
          </GlassCard>
        </div>
      </div>
    </DashboardLayout>
  );
}
