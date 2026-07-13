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
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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
import { CrimePieChart } from "@/components/crimes/CrimePieChart";

interface CrimeROI {
  crime_name: string;
  total_value: number;
  nerve_spent: number;
  profit_per_nerve: number;
}


export default function CrimesDashboard() {
  const [data, setData] = useState<CrimeROI[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([{ id: "profit_per_nerve", desc: true }]);
  const showLoader = useMinimumLoading(loading, 2000);

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

  const columns = useMemo(
    () => [
      {
        accessorKey: "crime_name",
        header: () => <div className="text-left">Crime Name</div>,
        cell: (info: any) => <span className="font-medium">{info.getValue()}</span>,
      },
      {
        accessorKey: "nerve_spent",
        header: () => <div className="text-right cursor-pointer select-none">Total Nerve Spent</div>,
        cell: (info: any) => <div className="text-right">{info.getValue().toLocaleString()}</div>,
      },
      {
        accessorKey: "total_value",
        header: () => <div className="text-right cursor-pointer select-none">Total Value Generated</div>,
        cell: (info: any) => (
          <div className="text-right text-emerald-600 dark:text-emerald-400">
            {formatCurrency(info.getValue())}
          </div>
        ),
      },
      {
        accessorKey: "profit_per_nerve",
        header: () => (
          <div className="text-right font-bold text-emerald-600 dark:text-emerald-400 cursor-pointer select-none">
            Profit / Nerve
          </div>
        ),
        cell: (info: any) => (
          <div className="text-right font-bold text-emerald-600 dark:text-emerald-400">
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

  if (showLoader) {
    return (
      <DashboardLayout>
        <GlobalLoading />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6 pt-15">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-3">
            <Target className="text-emerald-500" /> Crime Ledger
          </h1>
          <p className="text-zinc-500 mt-2">
            True Return on Investment for crimes, factoring in failure rates and critical fails.
          </p>
        </header>

        {data.length > 0 && (
          <>
            <CrimeKPICards data={data} />
            <CrimePieChart data={data} />
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="text-indigo-400" /> ROI Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>

            {data.length === 0 ? (
              <div className="flex justify-center p-8 text-zinc-500">No crime data available yet. Run the baseline seeder.</div>
            ) : (
              <div className="rounded-md border border-zinc-200 dark:border-white/10">
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id} className="border-zinc-200 dark:border-white/10 hover:bg-transparent">
                        {headerGroup.headers.map((header) => (
                          <TableHead
                            key={header.id}
                            onClick={header.column.getToggleSortingHandler()}
                            className={header.column.getCanSort() ? "cursor-pointer select-none" : ""}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows.map((row) => (
                      <TableRow key={row.id} className="border-zinc-200 dark:border-white/10">
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
