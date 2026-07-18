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
import { motion } from "framer-motion";
import { Activity, Settings, Target } from "lucide-react";
import GlobalLoading from "@/components/dashboard/GlobalLoading";
import { useMinimumLoading } from "@/hooks/use-minimum-loading";
import { CrimeKPICards } from "@/components/crimes/CrimeKPICards";
import { CrimeBarChart } from "@/components/crimes/CrimeBarChart";
import { UnmappedCrimes } from "@/components/crimes/UnmappedCrimes";
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
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [allCrimes, setAllCrimes] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(false);
  const [moduleDisabled, setModuleDisabled] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: "profit_per_nerve", desc: true }]);
  const showLoader = useMinimumLoading(loading, 2000);

  const { setSyncOptions, setLastSyncedText } = useSync();

  const fetchCrimes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/crimes");
      if (!res.ok) throw new Error("Failed to fetch crime ROI");
      const json = await res.json();

      if (json.module_disabled) {
        setModuleDisabled(true);
        setIsPolling(false);
      } else if (json.initializing) {
        setModuleDisabled(false);
        setIsPolling(true);
      } else {
        setModuleDisabled(false);
        setIsPolling(false);
        setData(json.data || []);

        // Fetch recent logs once we have data
        const recentRes = await fetch("/api/crimes/recent");
        if (recentRes.ok) {
          const recentJson = await recentRes.json();
          setRecentLogs(recentJson.data || []);
        }

        const unmappedRes = await fetch("/api/crimes/unmapped");
        if (unmappedRes.ok) {
          const uJson = await unmappedRes.json();
          setUnmapped(uJson.data || []);
        }

        const allRes = await fetch("/api/crimes/all");
        if (allRes.ok) {
          const aJson = await allRes.json();
          setAllCrimes(aJson.data || []);
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
        header: () => <div className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">CRIME_NAME</div>,
        cell: (info: any) => <span className="font-mono text-sm text-foreground">{info.getValue()}</span>,
      },
      {
        accessorKey: "nerve_spent",
        header: () => <div className="text-right cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">NERVE_SPENT</div>,
        cell: (info: any) => <div className="text-right font-mono text-sm text-foreground">{info.getValue().toLocaleString()}</div>,
      },
      {
        accessorKey: "total_value",
        header: () => <div className="text-right cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">TOTAL_VALUE</div>,
        cell: (info: any) => (
          <div className="text-right font-mono text-sm text-foreground">
            {formatCurrency(info.getValue())}
          </div>
        ),
      },
      {
        accessorKey: "profit_per_nerve",
        header: () => (
          <div className="text-right cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            PROFIT_PER_NERVE
          </div>
        ),
        cell: (info: any) => (
          <div className="text-right font-mono text-sm text-foreground">
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
      // Wait for the settings to be persisted before polling
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crimes_module_enabled: true })
      });
      setSettings({ ...settings, crimes_module_enabled: true });
      fetchCrimes();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <DashboardLayout>
      <ModuleGuard>
        {moduleDisabled ? (
          <div className="flex-1 flex flex-col items-center justify-center h-[80vh] text-center p-8">
            <Target size={32} className="text-foreground mb-6" />
            <div className="text-foreground font-mono tracking-widest text-sm mb-4 uppercase">
              [ CRIMES_MODULE_OFFLINE ]
            </div>
            <div className="text-muted-foreground font-mono text-[10px] uppercase tracking-widest max-w-md leading-relaxed mb-8">
              This module is currently disabled. Initializing this module will allow Sentinel to track and analyze your crime ledger.
            </div>
            <button
              onClick={handleInitialize}
              className="px-6 py-3 bg-foreground text-background font-mono text-[10px] uppercase tracking-[0.2em] hover:opacity-90 transition-colors"
            >
              INITIALIZE_MODULE
            </button>
          </div>
        ) : (
          <div className="max-w-7xl p-2 md:p-8 mx-auto flex flex-col gap-6 pt-15">
            <header className="mb-2 border-b border-border pb-4 flex items-start justify-between">
              <div>
                <h1 className="text-xl font-mono text-foreground flex items-center gap-3 uppercase tracking-[0.2em]">
                  <Target size={20} className="text-foreground" /> CRIME_LEDGER
                </h1>
                <p className="text-muted-foreground font-mono text-[10px] mt-2 uppercase tracking-[0.2em]">
                  True Return on Investment for crimes, factoring in failure rates and critical fails.
                </p>
              </div>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors rounded-sm shrink-0"
              >
                <Settings size={16} />
              </button>
            </header>

            <UnmappedCrimes 
              unmappedActions={unmapped} 
              allCrimes={allCrimes} 
              onMapped={fetchCrimes} 
            />

            {data.length > 0 && (
              <>
                <CrimeKPICards data={data} />
                <CrimeBarChart data={data} />
              </>
            )}

            <div className="border border-border bg-card p-6">
              <div className="flex items-center gap-2 font-mono text-foreground text-[10px] uppercase tracking-[0.2em] mb-6">
                <Activity size={16} /> ROI_ANALYSIS
              </div>
              <div>
                {data.length === 0 ? (
                  <div className="flex justify-center p-8 text-muted-foreground font-mono text-[10px] uppercase tracking-widest">No crime data available yet.</div>
                ) : (
                  <div className="border border-border">
                    <Table>
                      <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                          <TableRow key={headerGroup.id} className="border-border hover:bg-transparent">
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
                          <TableRow key={row.id} className="border-border hover:bg-accent/50">
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

        {isSettingsOpen && (
          <CrimesSettingsModal
            enabled={!moduleDisabled}
            onClose={() => setIsSettingsOpen(false)}
            onSave={async (enabled) => {
              await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ crimes_module_enabled: enabled }),
              });
              setSettings({ ...settings, crimes_module_enabled: enabled });
              fetchCrimes();
            }}
          />
        )}
      </ModuleGuard>
    </DashboardLayout>
  );
}

function CrimesSettingsModal({
  enabled,
  onClose,
  onSave,
}: {
  enabled: boolean;
  onClose: () => void;
  onSave: (enabled: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState(enabled);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-card border border-border p-6 shadow-2xl relative"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
        <h2 className="text-xl font-mono text-foreground mb-6 uppercase tracking-widest border-b border-border pb-4">
          CRIMES_SETTINGS
        </h2>

        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-sm text-foreground">CRIMES_MODULE</div>
              <div className="text-xs text-muted-foreground mt-1">Enable crime ledger tracking and analysis.</div>
            </div>
            <button
              onClick={() => setDraft((d) => !d)}
              className={`w-12 h-6 rounded-none transition-colors relative ${draft ? "bg-foreground" : "bg-muted"
                }`}
            >
              <div
                className={`absolute top-1 left-1 size-4 bg-background rounded-none transition-transform ${draft ? "translate-x-6" : ""
                  }`}
              />
            </button>
          </div>

          <div className="pt-4 border-t border-border flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-mono tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              CANCEL
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-foreground text-background text-xs font-mono tracking-widest hover:opacity-90 transition-colors disabled:opacity-50"
            >
              {isSaving ? "SAVING..." : "SAVE"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
