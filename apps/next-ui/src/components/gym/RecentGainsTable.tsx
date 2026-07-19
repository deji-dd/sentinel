"use client";

import React, { useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Clock } from "lucide-react";
import { GymLedgerEntry } from "./GymHistoryChart";

interface RecentGainsTableProps {
  data: GymLedgerEntry[];
  initTimestamp?: number;
}

export function RecentGainsTable({ data, initTimestamp }: RecentGainsTableProps) {
  const todayData = useMemo(() => {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const cutoffTime = Math.max(todayStart.getTime(), (initTimestamp || 0) * 1000);
    return data
      .filter((entry) => new Date(entry.timestamp * 1000).getTime() >= cutoffTime)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [data, initTimestamp]);

  const columns = useMemo(
    () => [
      {
        accessorKey: "timestamp",
        header: () => (
          <div className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            TIME
          </div>
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cell: (info: any) => {
          const date = new Date(info.getValue() * 1000);
          return (
            <span className="font-mono text-sm text-muted-foreground">
              {date.toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                timeZone: "UTC"
              })}
            </span>
          );
        },
      },
      {
        accessorKey: "stat_type",
        header: () => (
          <div className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            STAT_TYPE
          </div>
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cell: (info: any) => (
          <span className="font-mono text-sm text-foreground capitalize">
            {info.getValue()}
          </span>
        ),
      },
      {
        accessorKey: "energy_used",
        header: () => (
          <div className="text-right font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            ENERGY
          </div>
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cell: (info: any) => {
          const entry = info.row.original as GymLedgerEntry;
          return (
            <div className="text-right font-mono text-sm text-foreground">
              {entry.energy_used ? `${entry.energy_used}E` : "-"}
            </div>
          );
        },
      },
      {
        accessorKey: "stat_gained",
        header: () => (
          <div className="text-right font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            GAINED
          </div>
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cell: (info: any) => (
          <div className="text-right font-mono text-sm text-foreground">
            +{Number(info.getValue()).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        ),
      },
    ],
    []
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: todayData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="border border-border bg-card p-6 mt-8">
      <div className="flex items-center gap-2 font-mono text-foreground text-[10px] uppercase tracking-[0.2em] mb-6">
        <Clock size={16} /> TODAY&apos;S_GAINS
      </div>
      <div>
        {todayData.length === 0 ? (
          <div className="flex justify-center p-8 text-muted-foreground font-mono text-[10px] uppercase tracking-widest">
            No gains logged today.
          </div>
        ) : (
          <div className="border border-border overflow-y-auto max-h-[400px]">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10 border-b border-border">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    key={headerGroup.id}
                    className="border-border hover:bg-transparent"
                  >
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="h-10 px-4">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="border-border hover:bg-accent/50"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="px-4 py-2">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
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
  );
}
