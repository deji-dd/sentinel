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
import { Activity, Target } from "lucide-react";
import GlobalLoading from "@/components/dashboard/GlobalLoading";
import { useMinimumLoading } from "@/hooks/use-minimum-loading";
import { CrimeKPICards } from "@/components/crimes/CrimeKPICards";
import { CrimeBarChart } from "@/components/crimes/CrimeBarChart";
import { CrimeHistoricalChart, CrimeHistoricalPoint } from "@/components/crimes/CrimeHistoricalChart";
import { UnmappedCrimes } from "@/components/crimes/UnmappedCrimes";
import { RecentCrimesTable, RecentCrimeLog } from "@/components/crimes/RecentCrimesTable";
import { CrimeActionMappingBrowser, CrimeMappingGroup } from "@/components/crimes/CrimeActionMappingBrowser";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  CrimesRoiResponse,
  CrimesRecentResponse,
  CrimesUnmappedResponse,
  CrimesAllResponse,
  CrimesHistoricalResponse,
  CrimeRoiItem,
} from "@sentinel/shared";


export default function CrimesDashboard() {
  const [data, setData] = useState<CrimeRoiItem[]>([]);
  const [recentLogs, setRecentLogs] = useState<RecentCrimeLog[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [mappingGroups, setMappingGroups] = useState<CrimeMappingGroup[]>([]);
  const [allCrimes, setAllCrimes] = useState<{ id: number; name: string }[]>([]);
  const [historicalData, setHistoricalData] = useState<CrimeHistoricalPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(false);
  const [timeframe, setTimeframe] = useState<"7d" | "30d" | "90d" | "all">("30d");

  const [sorting, setSorting] = useState<SortingState>([{ id: "profit_per_nerve", desc: true }]);
  const showLoader = useMinimumLoading(loading, 2000);

  const { setSyncOptions, setLastSyncedText } = useSync();

  const fetchCrimes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/crimes");
      if (!res.ok) throw new Error("Failed to fetch crime ROI");
      const json: CrimesRoiResponse = await res.json();

      if (json.initializing) {
        setIsPolling(true);
      } else {
        setIsPolling(false);
        setData(json.data || []);

        // Fetch recent logs once we have data
        const recentRes = await fetch("/api/crimes/recent");
        if (recentRes.ok) {
          const recentJson: CrimesRecentResponse = await recentRes.json();
          setRecentLogs(recentJson.data || []);
        }

        const unmappedRes = await fetch("/api/crimes/unmapped");
        if (unmappedRes.ok) {
          const uJson: CrimesUnmappedResponse = await unmappedRes.json();
          setUnmapped(uJson.data || []);
        }

        const allRes = await fetch("/api/crimes/all");
        if (allRes.ok) {
          const aJson: CrimesAllResponse = await allRes.json();
          setAllCrimes(aJson.data || []);
        }

        const mappingsRes = await fetch("/api/crimes/mappings");
        if (mappingsRes.ok) {
          const mJson = await mappingsRes.json();
          setMappingGroups(mJson.data || []);
        }

        const histRes = await fetch("/api/crimes/historical");
        if (histRes.ok) {
          const hJson: CrimesHistoricalResponse = await histRes.json();
          setHistoricalData(hJson.data || []);
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
      setSyncOptions(null);
      setLastSyncedText("");
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

  const [now, setNow] = React.useState<number>(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
  }, [timeframe]);

  const filteredHistorical = useMemo(() => {
    return historicalData.filter((item) => {
      if (timeframe === "all") return true;
      const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90;
      return item.timestamp * 1000 >= now - (days * 86400 * 1000);
    });
  }, [historicalData, timeframe, now]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });



  if (showLoader || isPolling) {
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
                <Target size={20} className="text-foreground" /> CRIME_LEDGER
              </h1>
              <p className="text-muted-foreground font-mono text-[10px] mt-2 uppercase tracking-[0.2em]">
                True Return on Investment for crimes, factoring in failure rates and critical fails.
              </p>
            </div>
            <Dialog>
              <DialogTrigger className="px-4 py-2 border border-border text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-destructive hover:border-destructive/50 transition-colors">
                Reset Ledger
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reset Crime Ledger?</DialogTitle>
                  <DialogDescription>
                    This action will permanently delete all tracked crime history and ROI data. This cannot be undone. Are you sure you want to proceed?
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="destructive" onClick={async () => {
                    await fetch("/api/crimes/reset-ledger", { method: "POST" });
                    fetchCrimes();
                  }}>
                    Yes, reset ledger
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </header>

          <UnmappedCrimes
            unmappedActions={unmapped}
            allCrimes={allCrimes}
            onMapped={fetchCrimes}
          />

          <CrimeActionMappingBrowser
            groups={mappingGroups}
            allCrimes={allCrimes}
            onRemapped={fetchCrimes}
          />

          {data.length > 0 && (
            <>
              <CrimeKPICards data={data} />
              <CrimeBarChart data={data} />
              <div className="mb-8">
                <Card className="rounded-none border-border bg-card">
                  <CardHeader className="flex flex-row items-center justify-between border-b border-border mb-6 p-4">
                    <CardTitle className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground">
                      <Activity className="w-4 h-4" />
                      <span>Historical Profit</span>
                    </CardTitle>
                    <div className="flex bg-muted rounded-none p-1">
                      {["7d", "30d", "90d", "all"].map((t) => (
                        <button
                          key={t}
                          onClick={() => setTimeframe(t as "7d" | "30d" | "90d" | "all")}
                          className={`px-3 py-1 text-[10px] font-mono tracking-widest uppercase transition-colors ${timeframe === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    <CrimeHistoricalChart data={filteredHistorical} />
                  </CardContent>
                </Card>
              </div>
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
    </DashboardLayout>
  );
}
