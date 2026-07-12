"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useSync } from "@/hooks/use-sync";
import { DashboardLayout } from "@/components/dashboard-layout";
import { GlassCard } from "@/components/dashboard/GlassCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, Target } from "lucide-react";

interface CrimeROI {
  crime_name: string;
  total_value: number;
  nerve_spent: number;
  profit_per_nerve: number;
}

export default function CrimesDashboard() {
  const [data, setData] = useState<CrimeROI[]>([]);
  const [loading, setLoading] = useState(true);

  const { setSyncOptions, setLastSyncedText } = useSync();

  const fetchCrimes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/crimes/roi");
      if (!res.ok) throw new Error("Failed to fetch crime ROI");
      const json = await res.json();
      setData(json.data || []);
      setLastSyncedText(`Last synced at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error("Error fetching crime ROI:", error);
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
          label: "Sync Crime Ledger",
          action: fetchCrimes,
        },
      ]);
    }, 0);

    fetchCrimes();

    return () => {
      isMounted = false;
      setTimeout(() => {
        setSyncOptions(null);
        setLastSyncedText("");
      }, 0);
    };
  }, [setSyncOptions, fetchCrimes, setLastSyncedText]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-3">
            <Target className="text-emerald-500" /> Crime Ledger
          </h1>
          <p className="text-zinc-500 mt-2">
            True Return on Investment for crimes, factoring in failure rates and critical fails.
          </p>
        </header>

        <GlassCard className="glass-widget overflow-hidden" tiltIntensity={0}>
          <div className="p-6">
            <h2 className="text-xl font-bold flex items-center gap-2 mb-6">
              <Activity className="text-indigo-400" /> ROI Analysis
            </h2>
            
            {loading ? (
              <div className="flex justify-center p-8 text-zinc-500">Loading data...</div>
            ) : data.length === 0 ? (
              <div className="flex justify-center p-8 text-zinc-500">No crime data available yet. Run the baseline seeder.</div>
            ) : (
              <div className="rounded-md border border-zinc-200 dark:border-white/10">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-200 dark:border-white/10 hover:bg-transparent">
                      <TableHead>Crime Name</TableHead>
                      <TableHead className="text-right">Total Nerve Spent</TableHead>
                      <TableHead className="text-right">Total Value Generated</TableHead>
                      <TableHead className="text-right font-bold text-emerald-600 dark:text-emerald-400">Profit / Nerve</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((row) => (
                      <TableRow key={row.crime_name} className="border-zinc-200 dark:border-white/10">
                        <TableCell className="font-medium">{row.crime_name}</TableCell>
                        <TableCell className="text-right">{row.nerve_spent.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{formatCurrency(row.total_value)}</TableCell>
                        <TableCell className="text-right font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(row.profit_per_nerve)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </DashboardLayout>
  );
}
