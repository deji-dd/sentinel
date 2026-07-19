"use client";

import React, { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { useWealthLedger } from "@/hooks/use-wealth-ledger";
import { KPICards } from "@/components/wealth/KPICards";
import { WealthChart } from "@/components/wealth/WealthChart";
import { LedgerTable } from "@/components/wealth/LedgerTable";
import { ActionQueueSheet } from "@/components/wealth/ActionQueueSheet";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Activity, List } from "lucide-react";
import { useSync } from "@/hooks/use-sync";
import GlobalLoading from "@/components/dashboard/GlobalLoading";
import { useMinimumLoading } from "@/hooks/use-minimum-loading";
import { ModuleGuard } from "@/components/module-guard";
import { useSettings } from "@/components/settings-provider";
import { Target } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function WealthPage() {
  const { data, loading, moduleDisabled, isPolling, refetch } = useWealthLedger();
  const { settings, setSettings } = useSettings();
  const showLoader = useMinimumLoading(loading || isPolling, 2000);
  const { setSyncOptions, setLastSyncedText } = useSync();
  const [timeframe, setTimeframe] = React.useState<"7d" | "30d" | "90d" | "all">("30d");

  const [isHealing, setIsHealing] = React.useState(false);
  const [healOpen, setHealOpen] = React.useState(false);
  const [isResetting, setIsResetting] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);

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



  const [now, setNow] = React.useState<number>(() => Date.now());
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
  }, [timeframe]);

  const [startOfTodayUTC] = React.useState<Date>(() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  });

  const [isInitializing, setIsInitializing] = useState(false);

  if (showLoader) {
    return (
      <DashboardLayout>
        <GlobalLoading />
      </DashboardLayout>
    );
  }

  const handleInitialize = async () => {
    try {
      setIsInitializing(true);
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wealth_module_enabled: true })
      });
      await fetch("/api/wealth/init", { method: "POST" });
      setSettings({ ...settings, wealth_module_enabled: true });
      refetch();
    } catch (e) {
      console.error(e);
      setIsInitializing(false);
    }
  };

  const filteredHistorical = data?.historical?.filter((item: { timestamp: number }) => {
    if (timeframe === "all") return true;
    const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90;
    return item.timestamp >= now - (days * 86400 * 1000);
  }) || [];

  const todaysTransactions = data?.recentTransactions?.filter((tx: { timestamp: number }) => {
    return tx.timestamp * 1000 >= startOfTodayUTC.getTime();
  }) || [];

  return (
    <DashboardLayout>
      <ModuleGuard>
        {moduleDisabled ? (
          <div className="flex-1 flex flex-col items-center justify-center h-[80vh] text-center p-8">
            <Target size={32} className="text-foreground mb-6" />
            <div className="text-foreground font-mono tracking-widest text-sm mb-4 uppercase">
              [ WEALTH_MODULE_OFFLINE ]
            </div>
            <div className="text-muted-foreground font-mono text-[10px] uppercase tracking-widest max-w-md leading-relaxed mb-8">
              This module is currently disabled. Initializing this module will allow Sentinel to track and analyze your total net worth and liquid cash changes.
            </div>
            <button
              onClick={handleInitialize}
              disabled={isInitializing}
              className="px-6 py-3 cursor-pointer bg-foreground text-background font-mono text-[10px] uppercase tracking-[0.2em] hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isInitializing && <Activity className="size-3 animate-spin" />}
              {isInitializing ? "INITIALIZING..." : "INITIALIZE_MODULE"}
            </button>
          </div>
        ) : data ? (
          <div className="max-w-7xl p-2 md:p-8 mx-auto flex flex-col gap-6 pt-15">
            <header className="mb-2 border-b border-border pb-4 flex items-start justify-between">
              <div>
                <h1 className="text-xl font-mono text-foreground flex items-center gap-3 uppercase tracking-[0.2em]">
                  <Activity size={20} className="text-foreground" /> WEALTH_PORTFOLIO
                </h1>
                <p className="text-muted-foreground font-mono text-[10px] mt-2 uppercase tracking-[0.2em]">
                  Total Net Worth and Asset Matrix Visualization
                </p>
              </div>
              <div className="flex gap-2">
                <Dialog open={healOpen} onOpenChange={setHealOpen}>
                  <DialogTrigger className="px-4 py-2 border cursor-pointer border-border text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-emerald-500/10 hover:border-emerald-500/50 transition-colors">
                    Heal Ledger
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Heal Wealth Ledger?</DialogTitle>
                      <DialogDescription>
                        This will re-scan your past logs since ledger initialization and recover any missing items or cash transactions that failed to parse previously. Existing transactions will not be modified.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline" disabled={isHealing} onClick={async () => {
                        setIsHealing(true);
                        await fetch("/api/wealth/heal", { method: "POST" });
                        await refetch();
                        setIsHealing(false);
                        setHealOpen(false);
                      }}>
                        {isHealing && <Activity className="size-3 animate-spin mr-2" />}
                        {isHealing ? "Healing..." : "Heal Ledger"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog open={resetOpen} onOpenChange={setResetOpen}>
                  <DialogTrigger className="px-4 py-2 border cursor-pointer border-border text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-destructive hover:border-destructive/50 transition-colors">
                    Reset Ledger
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Reset Wealth Ledger?</DialogTitle>
                      <DialogDescription>
                        This action will permanently delete all tracked net worth and liquid cash data. This cannot be undone. Are you sure you want to proceed?
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="destructive" disabled={isResetting} onClick={async () => {
                        setIsResetting(true);
                        await fetch("/api/wealth/reset-ledger", { method: "POST" });
                        await refetch();
                        setIsResetting(false);
                        setResetOpen(false);
                      }}>
                        {isResetting && <Activity className="size-3 animate-spin mr-2" />}
                        {isResetting ? "Resetting..." : "Yes, reset ledger"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </header>

            <div className="flex justify-end">
              <ActionQueueSheet items={data.actionQueue} />
            </div>

            <div>
              <KPICards
                liquidCash={data.liquidCash}
                dailyYield={data.dailyYield}
              />
            </div>

            <div className="mb-8">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
                    <span>Historical Net Worth Trajectory</span>
                  </CardTitle>
                  <div className="flex bg-muted rounded-md p-1">
                    {["7d", "30d", "90d", "all"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setTimeframe(t as "7d" | "30d" | "90d" | "all")}
                        className={`px-3 py-1 text-xs font-medium rounded-sm capitalize transition-colors ${timeframe === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <WealthChart data={filteredHistorical} />
                </CardContent>
              </Card>
            </div>

            <div>
              <Card>
                <CardHeader className="border-b border-zinc-200 dark:border-white/5 mb-6">
                  <CardTitle className="flex items-center gap-2">
                    <List className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    <span>Today&apos;s Transactions (UTC)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <LedgerTable data={todaysTransactions} />
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}
      </ModuleGuard>
    </DashboardLayout>
  );
}
