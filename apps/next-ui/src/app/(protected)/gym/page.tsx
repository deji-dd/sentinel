"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useSync } from "@/hooks/use-sync";
import { DashboardLayout } from "@/components/dashboard-layout";
import GlobalLoading from "@/components/dashboard/GlobalLoading";
import { useMinimumLoading } from "@/hooks/use-minimum-loading";
import { GymHistoryChart, GymLedgerEntry } from "@/components/gym/GymHistoryChart";
import { RecentGainsTable } from "@/components/gym/RecentGainsTable";
import { EfficiencyTable } from "@/components/gym/EfficiencyTable";
import { BoosterEfficiencyTable } from "@/components/gym/BoosterEfficiencyTable";
import { Activity } from "lucide-react";
import { GymHistoryResponse, GymStateResponse, GymStateData } from "@sentinel/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function GymDashboard() {
  const [data, setData] = useState<GymLedgerEntry[]>([]);
  const [gymState, setGymState] = useState<GymStateData | null>(null);
  const [initTimestamp, setInitTimestamp] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(false);

  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const showLoader = useMinimumLoading(loading, 1000);

  const timeframeStats = useMemo(() => {
    let cutoffDate = new Date(0);
    const now = new Date();
    if (timeRange === "7d") {
      cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === "30d") {
      cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeRange === "90d") {
      cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    }

    const filteredData = data.filter((entry) => {
      const entryDate = new Date(entry.timestamp * 1000);
      return entryDate.getTime() > cutoffDate.getTime();
    });

    let totalGains = 0;
    let totalEnergy = 0;

    for (const entry of filteredData) {
      if (
        entry.stat_type === "strength" ||
        entry.stat_type === "defense" ||
        entry.stat_type === "speed" ||
        entry.stat_type === "dexterity"
      ) {
        totalGains += entry.stat_gained;
      }
      if (entry.energy_used) {
        totalEnergy += entry.energy_used;
      }
    }

    let days = 1;
    if (filteredData.length > 0) {
      const oldestEntryTimestamp = filteredData[0].timestamp * 1000;
      const actualDays = (now.getTime() - Math.max(oldestEntryTimestamp, cutoffDate.getTime())) / (1000 * 60 * 60 * 24);
      days = Math.max(1, actualDays);
    }

    return {
      avgGainsPerDay: totalGains / days,
      avgEnergyPerDay: totalEnergy / days,
    };
  }, [data, timeRange]);

  const formatStatNumber = (value: number) => {
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(2)}B`;
    }
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(2)}K`;
    }
    return value.toFixed(0);
  };

  const { setSyncOptions, setLastSyncedText } = useSync();

  const fetchGymData = useCallback(async (isBackgroundRefresh: boolean = false) => {
    if (!isBackgroundRefresh) {
      setLoading(true);
    }
    try {
      const [historyRes, stateRes] = await Promise.all([
        fetch("/api/gym/history"),
        fetch("/api/gym/state")
      ]);

      if (!historyRes.ok || !stateRes.ok) {
        throw new Error("Failed to fetch gym data");
      }

      const historyJson: GymHistoryResponse = await historyRes.json();
      const stateJson: GymStateResponse = await stateRes.json();

      setIsPolling(historyJson.initializing || stateJson.initializing || false);
      setInitTimestamp(historyJson.initTimestamp);
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
    if (isPolling) {
      const timer = setInterval(() => fetchGymData(true), 2000);
      return () => clearInterval(timer);
    }
  }, [isPolling, fetchGymData]);

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
    fetchGymData(false);

    return () => {
      isMounted = false;
      setSyncOptions(null);
      setLastSyncedText("");
    };
  }, [setSyncOptions, fetchGymData, setLastSyncedText, isPolling]);

  if (showLoader) {
    return (
      <DashboardLayout>
        <GlobalLoading />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-7xl p-2 md:p-8 mx-auto flex flex-col gap-6 pt-15">
        <header className="mb-2 border-b border-border pb-4 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-mono text-foreground flex items-center gap-3 uppercase tracking-[0.2em]">
              <Activity size={20} className="text-foreground" /> GYM_DASHBOARD
            </h1>
            <p className="text-muted-foreground font-mono text-[10px] mt-2 uppercase tracking-[0.2em]">
              Track gym efficiency, booster usage, and historical stat gains.
            </p>
          </div>
        </header>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
          <div className="flex gap-4">
            <div className="bg-muted/50 p-4 border border-border rounded-none">
              <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-2">Avg Gains / Day</div>
              <div className="text-xl font-medium font-mono text-foreground">{formatStatNumber(timeframeStats.avgGainsPerDay)}</div>
            </div>
            <div className="bg-muted/50 p-4 border border-border rounded-none">
              <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-2">Avg Energy / Day</div>
              <div className="text-xl font-medium font-mono text-foreground">{formatStatNumber(timeframeStats.avgEnergyPerDay)}</div>
            </div>
          </div>

          <div className="flex flex-col gap-2 md:items-end">
            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Timeframe Filter</div>
            <Select
              value={timeRange}
              onValueChange={(val) => setTimeRange(val as "7d" | "30d" | "90d" | "all")}
            >
              <SelectTrigger className="w-[180px] bg-background border-border font-mono text-xs rounded-none">
                <SelectValue placeholder="Select time range" />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                <SelectItem value="7d" className="font-mono text-xs">Last 7 Days</SelectItem>
                <SelectItem value="30d" className="font-mono text-xs">Last 30 Days</SelectItem>
                <SelectItem value="90d" className="font-mono text-xs">Last 3 Months</SelectItem>
                <SelectItem value="all" className="font-mono text-xs">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>
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

        <GymHistoryChart data={data} timeRange={timeRange} />

        <RecentGainsTable data={data} initTimestamp={initTimestamp} />
      </div>
    </DashboardLayout>
  );
}
