"use client";

import React, { useEffect } from "react";
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

export default function WealthPage() {
  const { data, loading, refetch } = useWealthLedger();
  const showLoader = useMinimumLoading(loading || !data, 2000);
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



  if (showLoader || !data) {
    return (
      <DashboardLayout>
        <GlobalLoading />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="pt-15">
        <div className="flex flex-col md:flex-row gap-5 md:items-center md:justify-between mb-8">
          <div>
            <h1 className="text-4xl font-black tracking-tighter text-zinc-900 dark:text-zinc-100 mb-1">Wealth & Ledger</h1>
            <p className="text-zinc-500 dark:text-zinc-400">Total Net Worth and Asset Matrix Visualization</p>
          </div>
          <div>
            <ActionQueueSheet items={data.actionQueue} />
          </div>
        </div>

        <div>
          <KPICards
            liquidCash={data.liquidCash}
            dailyYield={data.dailyYield}
          />
        </div>

        <div className="mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
                <span>30-Day Net Worth Trajectory</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <WealthChart data={data.historical} />
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader className="border-b border-zinc-200 dark:border-white/5 mb-6">
              <CardTitle className="flex items-center gap-2">
                <List className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <span>Recent Transactions</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LedgerTable data={data.recentTransactions} />
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
