/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  SortingState,
} from "@tanstack/react-table";
import { useSync } from "@/hooks/use-sync";
import { DashboardLayout } from "@/components/dashboard-layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, Target } from "lucide-react";
import GlobalLoading from "@/components/dashboard/GlobalLoading";
import { useMinimumLoading } from "@/hooks/use-minimum-loading";
import { CrimeKPICards } from "@/components/crimes/CrimeKPICards";
import { CrimeBarChart } from "@/components/crimes/CrimeBarChart";
import { RecentCrimesTable, RecentCrimeLog } from "@/components/crimes/RecentCrimesTable";
import { ModuleGuard } from "@/components/module-guard";
import { useSettings } from "@/components/settings-provider";

interface CrimeROI {
  crime_name: string;
  total_value: number;
  nerve_spent: number;
  profit_per_nerve: number;
}


export default function CrimesDashboard() {
  const [data, setData] = useState<CrimeROI[]>([]);
  const [recentLogs, setRecentLogs] = useState<RecentCrimeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: "profit_per_nerve", desc: true }]);
  const showLoader = useMinimumLoading(loading, 2000);

  const { setSyncOptions, setLastSyncedText } = useSync();

  const fetchCrimes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/crimes");
      if (!res.ok) throw new Error("Failed to fetch crime ROI");
      const json = await res.json();
      
      if (json.initializing) {
        setIsPolling(true);
      } else {
        setIsPolling(false);
        setData(json.data || []);
        
        // Fetch recent logs once we have data
        const recentRes = await fetch("/api/crimes/recent");
        if (recentRes.ok) {
          const recentJson = await recentRes.json();
          setRecentLogs(recentJson.data || []);
        }

        setLastSyncedText(`Last synced at ${new Date().toLocaleTimeString()}`);
      }
    } catch (error) {
      console.error("Error fetching crime ROI:", error);
      setIsPolling(false);
    } finally {
      setLoading(false);
    }
  }, [setLastSyncedText]);

  useEffect(() => {
    if (isPolling) {
      const timer = setInterval(fetchCrimes, 2000);
      return () => clearInterval(timer);
    }
  }, [isPolling, fetchCrimes]);

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

  const columns = useMemo(
    () => [
      {
        accessorKey: "crime_name",
        header: () => <div className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">CRIME_NAME</div>,
        cell: (info: any) => <span className="font-mono text-sm text-white">{info.getValue()}</span>,
      },
      {
        accessorKey: "nerve_spent",
        header: () => <div className="text-right cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">NERVE_SPENT</div>,
        cell: (info: any) => <div className="text-right font-mono text-sm text-white">{info.getValue().toLocaleString()}</div>,
      },
      {
        accessorKey: "total_value",
        header: () => <div className="text-right cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">TOTAL_VALUE</div>,
        cell: (info: any) => (
          <div className="text-right font-mono text-sm text-white">
            {formatCurrency(info.getValue())}
          </div>
        ),
      },
      {
        accessorKey: "profit_per_nerve",
        header: () => (
          <div className="text-right cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.2em] text-white">
            PROFIT_PER_NERVE
          </div>
        ),
        cell: (info: any) => (
          <div className="text-right font-mono text-sm text-white">
            {formatCurrency(info.getValue())}
          </div>
        ),
      },
    ],
    []
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const { settings, setSettings } = useSettings();

  if (showLoader || isPolling) {
    return (
      <DashboardLayout>
        <GlobalLoading />
      </DashboardLayout>
    );
  }

  const handleInitialize = async () => {
    try {
      const newSettings = { ...settings, crimes_module_enabled: true };
      setSettings(newSettings);
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crimes_module_enabled: true })
      });
      // Also fetch baseline if needed, but for now just enabling the module allows data viewing.
      fetchCrimes();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <DashboardLayout>
      <ModuleGuard>
        {!settings.crimes_module_enabled ? (
          <div className="flex-1 flex flex-col items-center justify-center h-[80vh] text-center p-8">
            <Target size={32} className="text-white mb-6" />
            <div className="text-white font-mono tracking-widest text-sm mb-4 uppercase">
              [ CRIMES_MODULE_OFFLINE ]
            </div>
            <div className="text-neutral-500 font-mono text-[10px] uppercase tracking-widest max-w-md leading-relaxed mb-8">
              This module is currently disabled. Initializing this module will allow Sentinel to track and analyze your crime ledger.
            </div>
            <button
              onClick={handleInitialize}
              className="px-6 py-3 bg-white text-black font-mono text-[10px] uppercase tracking-[0.2em] hover:bg-neutral-200 transition-colors"
            >
              INITIALIZE_MODULE
            </button>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto flex flex-col gap-6 pt-15">
          <header className="mb-2 border-b border-neutral-900 pb-4">
            <h1 className="text-xl font-mono text-white flex items-center gap-3 uppercase tracking-[0.2em]">
              <Target size={20} className="text-white" /> CRIME_LEDGER
            </h1>
            <p className="text-neutral-500 font-mono text-[10px] mt-2 uppercase tracking-[0.2em]">
              True Return on Investment for crimes, factoring in failure rates and critical fails.
            </p>
          </header>

          {data.length > 0 && (
            <>
              <CrimeKPICards data={data} />
              <CrimeBarChart data={data} />
            </>
          )}

          <div className="border border-neutral-900 bg-black p-6">
            <div className="flex items-center gap-2 font-mono text-white text-[10px] uppercase tracking-[0.2em] mb-6">
              <Activity size={16} /> ROI_ANALYSIS
            </div>
            <div>
              {data.length === 0 ? (
                <div className="flex justify-center p-8 text-neutral-500 font-mono text-[10px] uppercase tracking-widest">No crime data available yet.</div>
              ) : (
                <div className="border border-neutral-900">
                  <Table>
                    <TableHeader>
                      {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id} className="border-neutral-900 hover:bg-transparent">
                          {headerGroup.headers.map((header) => (
                            <TableHead
                              key={header.id}
                              onClick={header.column.getToggleSortingHandler()}
                              className={header.column.getCanSort() ? "cursor-pointer select-none h-10 px-4" : "h-10 px-4"}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {table.getRowModel().rows.map((row) => (
                        <TableRow key={row.id} className="border-neutral-900 hover:bg-neutral-900/50">
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id} className="px-4 py-3">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>

          <RecentCrimesTable data={recentLogs} />
        </div>
        )}
      </ModuleGuard>
    </DashboardLayout>
  );
}
