"use client";

import React, { useState, useMemo } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { TransactionItem } from "@/hooks/use-wealth-ledger";
import { ArrowUpDown, Search, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";

export const columns: ColumnDef<TransactionItem>[] = [
  {
    accessorKey: "timestamp",
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-500 dark:text-zinc-400 font-bold tracking-wider text-xs uppercase pl-4"
        >
          Date / Time
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      );
    },
    cell: ({ row }) => {
      const ts = row.getValue("timestamp") as number;
      const d = new Date(ts * 1000);
      const formattedDate = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const formattedTime = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return (
        <div className="pl-8 text-zinc-500 dark:text-zinc-400 text-sm">
          <span className="font-medium text-zinc-900 dark:text-zinc-200">{formattedDate}</span> <span className="text-xs">{formattedTime}</span>
        </div>
      );
    },
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => {
      const cat: string = row.getValue("category");
      let colorClass = "bg-zinc-500/10 text-zinc-600 dark:bg-zinc-500/20 dark:text-zinc-400";
      
      if (['purchase', 'sale', 'trade', 'barter'].includes(cat)) {
        colorClass = "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400";
      } else if (['income', 'injection'].includes(cat)) {
        colorClass = "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400";
      } else if (['loss', 'sink'].includes(cat)) {
        colorClass = "bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400";
      } else if (['transfer', 'storage_transfer'].includes(cat)) {
        colorClass = "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400";
      }

      return (
        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${colorClass}`}>
          {cat}
        </span>
      );
    },
    filterFn: "equalsString" // Exact match filtering for category
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => <div className="font-medium text-zinc-900 dark:text-zinc-200 max-w-[300px] truncate" title={row.getValue("description")}>{row.getValue("description")}</div>,
  },
  {
    accessorKey: "cashFlow",
    header: ({ column }) => {
      return (
        <div className="text-right">
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-500 dark:text-zinc-400 font-bold tracking-wider text-xs uppercase"
          >
            Cash Flow
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        </div>
      );
    },
    cell: ({ row }) => {
      const amount = parseFloat(row.getValue("cashFlow"));
      const isPositive = amount > 0;
      const isZero = amount === 0;
      
      return (
        <div className="text-right font-medium">
          <span className={
            isPositive ? "text-emerald-600 dark:text-emerald-400" : 
            isZero ? "text-zinc-400 dark:text-zinc-500" :
            "text-red-600 dark:text-red-400"
          }>
            {isPositive ? '+' : ''}{amount < 0 ? '-' : ''}
            ${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "amount",
    header: ({ column }) => {
      return (
        <div className="text-right pr-4">
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-500 dark:text-zinc-400 font-bold tracking-wider text-xs uppercase"
          >
            Net Impact
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        </div>
      );
    },
    cell: ({ row }) => {
      const amount = parseFloat(row.getValue("amount"));
      const isPositive = amount > 0;
      const isZero = amount === 0;
      
      return (
        <div className="text-right font-bold pr-4">
          <span className={
            isPositive ? "text-emerald-600 dark:text-emerald-400" : 
            isZero ? "text-zinc-400 dark:text-zinc-500" :
            "text-red-600 dark:text-red-400"
          }>
            {isPositive ? '+' : ''}{amount < 0 ? '-' : ''}
            ${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </span>
        </div>
      );
    },
  },
];

export function LedgerTable({ data }: { data: TransactionItem[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "timestamp", desc: true }]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Get unique categories for the dropdown
  const categories = useMemo(() => {
    const cats = new Set((data || []).map(item => item.category));
    return Array.from(cats).sort();
  }, [data]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: data || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onGlobalFilterChange: setGlobalFilter,
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: {
      sorting,
      globalFilter,
    },
    initialState: {
      pagination: {
        pageSize: 10,
      },
    },
  });

  // Apply category filter if set
  React.useEffect(() => {
    if (categoryFilter && categoryFilter !== "all") {
      table.getColumn("category")?.setFilterValue(categoryFilter);
    } else {
      table.getColumn("category")?.setFilterValue(undefined);
    }
  }, [categoryFilter, table]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Search transactions..."
            value={globalFilter ?? ""}
            onChange={(event) => setGlobalFilter(event.target.value)}
            className="pl-9 bg-white/50 dark:bg-black/20 border-zinc-200 dark:border-white/5 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-600 focus:border-indigo-500/50"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-zinc-500" />
          <select 
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-10 px-3 py-2 text-sm rounded-md border bg-white/50 dark:bg-black/20 border-zinc-200 dark:border-white/5 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          >
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="rounded-xl border border-zinc-200 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-md overflow-hidden">
        <Table>
          <TableHeader className="bg-zinc-100/50 dark:bg-white/5 border-b border-zinc-200 dark:border-white/5">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-zinc-200 dark:border-white/5 hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} className="h-12 border-zinc-200 dark:border-white/5">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="border-zinc-200 dark:border-white/5 hover:bg-zinc-100/50 dark:hover:bg-white/5 transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-4">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-zinc-500">
                  No transactions found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      
      {/* Pagination Controls */}
      <div className="flex items-center justify-between px-2 text-sm text-zinc-500 dark:text-zinc-400">
        <div>
          Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{" "}
          {Math.min(
            (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
            table.getFilteredRowModel().rows.length
          )}{" "}
          of {table.getFilteredRowModel().rows.length} entries
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="border-zinc-200 dark:border-white/10 bg-white/50 dark:bg-black/20 hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            Previous
          </Button>
          <div className="flex items-center gap-1 font-medium">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount() || 1}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="border-zinc-200 dark:border-white/10 bg-white/50 dark:bg-black/20 hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
