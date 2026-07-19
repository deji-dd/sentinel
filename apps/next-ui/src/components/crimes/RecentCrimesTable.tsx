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

export interface RecentCrimeLog {
  timestamp: number;
  crime_name: string;
  nerve_spent: number;
  total_value: number;
}

interface RecentCrimesTableProps {
  data: RecentCrimeLog[];
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
};

export function RecentCrimesTable({ data }: RecentCrimesTableProps) {
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
        accessorKey: "crime_name",
        header: () => (
          <div className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            CRIME_NAME
          </div>
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cell: (info: any) => (
          <span className="font-mono text-sm text-foreground">
            {info.getValue()}
          </span>
        ),
      },
      {
        accessorKey: "nerve_spent",
        header: () => (
          <div className="text-right font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            NERVE
          </div>
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cell: (info: any) => (
          <div className="text-right font-mono text-sm text-foreground">
            {info.getValue().toLocaleString()}
          </div>
        ),
      },
      {
        accessorKey: "total_value",
        header: () => (
          <div className="text-right font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            PROFIT
          </div>
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="border border-border bg-card p-6 mt-8">
      <div className="flex items-center gap-2 font-mono text-foreground text-[10px] uppercase tracking-[0.2em] mb-6">
        <Clock size={16} /> TODAY&apos;S_CRIMES
      </div>
      <div>
        {data.length === 0 ? (
          <div className="flex justify-center p-8 text-muted-foreground font-mono text-[10px] uppercase tracking-widest">
            No crimes logged today.
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
