"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useSync } from "@/hooks/use-sync";
import { DashboardLayout } from "@/components/dashboard-layout";
import GlobalLoading from "@/components/dashboard/GlobalLoading";
import { useMinimumLoading } from "@/hooks/use-minimum-loading";
import { GymHistoryChart, GymLedgerEntry } from "@/components/gym/GymHistoryChart";
import { EfficiencyTable } from "@/components/gym/EfficiencyTable";
import { BoosterEfficiencyTable } from "@/components/gym/BoosterEfficiencyTable";
import { GymStateData } from "@/lib/gym-math";
import { Activity } from "lucide-react";

export default function GymDashboard() {
  const [data, setData] = useState<GymLedgerEntry[]>([]);
  const [gymState, setGymState] = useState<GymStateData | null>(null);
  const [loading, setLoading] = useState(true);
  const showLoader = useMinimumLoading(loading, 1000);

  const { setSyncOptions, setLastSyncedText } = useSync();

  const fetchGymData = useCallback(async () => {
    setLoading(true);
    try {
      const [historyRes, stateRes] = await Promise.all([
        fetch("/api/gym/history"),
        fetch("/api/gym/state")
      ]);

      if (!historyRes.ok || !stateRes.ok) {
        throw new Error("Failed to fetch gym data");
      }

      const historyJson = await historyRes.json();
      const stateJson = await stateRes.json();

      setData(historyJson.data || []);
      setGymState(stateJson.data || null);

      setLastSyncedText(`Last synced at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error("Error fetching gym data:", error);
    } finally {
      setLoading(false);
    }
  }, [setLastSyncedText]);

  useEffect(() => {
    let isMounted = true;
    setTimeout(() => {
      if (!isMounted) return;
      setSyncOptions([
        {
          label: "Sync Gym Data",
          action: fetchGymData,
        },
      ]);
    }, 0);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGymData();

    return () => {
      isMounted = false;
      setTimeout(() => {
        setSyncOptions(null);
        setLastSyncedText("");
      }, 0);
    };
  }, [setSyncOptions, fetchGymData, setLastSyncedText]);

  if (showLoader) {
    return (
      <DashboardLayout>
        <GlobalLoading />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 md:p-4 p-0 pt-15">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center rounded-lg bg-primary/10 p-2">
            <Activity className="size-6 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Gym Dashboard</h1>
        </div>

        {gymState && gymState.gym_build_preference && gymState.battlestats ? (
          <div className="grid grid-cols-1 gap-6 items-start">
            <EfficiencyTable state={gymState} onPreferenceChanged={fetchGymData} />
            <BoosterEfficiencyTable gymState={gymState} historyData={data} />
          </div>
        ) : gymState ? (
          <div className="bg-muted/50 border rounded-lg p-8 text-center text-muted-foreground">
            Please make sure you have shared your battlestats with Sentinel to view gym efficiency.
          </div>
        ) : null}

        <GymHistoryChart data={data} />
      </div>
    </DashboardLayout>
  );
}
