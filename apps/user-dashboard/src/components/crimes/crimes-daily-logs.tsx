"use client";

import * as React from "react";
import { Calendar, Search, Filter, ChevronLeft, ChevronRight, RefreshCw, Zap } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface CrimeLogItem {
  id: string;
  crimeId: number;
  crimeName: string;
  action: string;
  nerve: number;
  value: number;
  timestamp: string;
}

interface CrimesDailyLogsProps {
  logs: CrimeLogItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  selectedDate: string;
  selectedCrimeId: string;
  searchQuery: string;
  categories?: Array<{ crimeId: number; crimeName: string }>;
  onDateChange: (date: string) => void;
  onCrimeIdChange: (crimeId: string) => void;
  onSearchChange: (query: string) => void;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
}

const CRIME_OPTIONS: Record<number, string> = {
  1: "Search for Cash",
  2: "Bootlegging",
  3: "Graffiti",
  4: "Shoplifting",
  5: "Pickpocketing",
  6: "Card Skimming",
  7: "Burglary",
  8: "Hustling",
  9: "Disposal",
  10: "Cracking",
  11: "Forgery",
  12: "Scamming",
  13: "Robbery",
  0: "Uncategorized",
};

function formatMoney(amount: number): string {
  const isNegative = amount < 0;
  const absVal = Math.abs(amount);
  let formatted = "";
  if (absVal >= 1_000_000_000) {
    formatted = `$${(absVal / 1_000_000_000).toFixed(2)}B`;
  } else if (absVal >= 1_000_000) {
    formatted = `$${(absVal / 1_000_000).toFixed(2)}M`;
  } else if (absVal >= 1_000) {
    formatted = `$${(absVal / 1_000).toFixed(1)}k`;
  } else {
    formatted = `$${absVal.toLocaleString()}`;
  }
  return isNegative ? `-${formatted}` : formatted;
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateDisplay(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CrimesDailyLogs({
  logs,
  pagination,
  selectedDate,
  selectedCrimeId,
  searchQuery,
  categories,
  onDateChange,
  onCrimeIdChange,
  onSearchChange,
  onPageChange,
  isLoading,
}: CrimesDailyLogsProps) {
  // Quick date button handlers (Today, Yesterday, Clear)
  const setToday = () => {
    const today = new Date().toISOString().split("T")[0];
    onDateChange(today);
  };

  const setYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    onDateChange(d.toISOString().split("T")[0]);
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5 space-y-4 shadow-sm">
      {/* Header & Filter Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Calendar className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Daily Crime Logs Explorer</h3>

          </div>
        </div>

        {/* Filters Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Picker Input */}
          <div className="relative">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="pl-3 pr-2 py-1.5 rounded-xl border border-border/60 bg-muted/30 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            />
          </div>

          {/* Quick Date Pills */}
          <button
            type="button"
            onClick={setToday}
            className="px-2.5 py-1.5 rounded-xl border border-border/60 bg-muted/40 hover:bg-muted text-xs font-medium text-foreground cursor-pointer"
          >
            Today
          </button>
          <button
            type="button"
            onClick={setYesterday}
            className="px-2.5 py-1.5 rounded-xl border border-border/60 bg-muted/40 hover:bg-muted text-xs font-medium text-foreground cursor-pointer"
          >
            Yesterday
          </button>
          {selectedDate && (
            <button
              type="button"
              onClick={() => onDateChange("")}
              className="px-2 py-1.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Clear Date
            </button>
          )}

          {/* Category Dropdown */}
          <select
            value={selectedCrimeId}
            onChange={(e) => onCrimeIdChange(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-border/60 bg-muted/30 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
          >
            <option value="">All Crimes</option>
            {categories && categories.length > 0
              ? categories.map((cat) => (
                <option key={cat.crimeId} value={cat.crimeId}>
                  #{cat.crimeId} - {cat.crimeName}
                </option>
              ))
              : Object.entries(CRIME_OPTIONS).map(([id, name]) => (
                <option key={id} value={id}>
                  #{id} - {name}
                </option>
              ))}
          </select>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search action..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 pr-3 py-1.5 rounded-xl border border-border/60 bg-muted/30 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-40"
            />
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-border/40 text-muted-foreground font-semibold">
              <th className="py-2.5 px-3">Date & Time</th>
              <th className="py-2.5 px-3">Crime Category</th>
              <th className="py-2.5 px-3">Action Executed</th>
              <th className="py-2.5 px-3 text-right">Nerve Cost</th>
              <th className="py-2.5 px-3 text-right font-mono">Net Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground">
                  <RefreshCw className="size-4 animate-spin mx-auto mb-2" />
                  Loading crime logs...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground italic">
                  No crime logs match the selected filters.
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const isUncategorized = log.crimeId === 0;
                const isLoss = log.value < 0;

                return (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 px-3 whitespace-nowrap text-muted-foreground font-mono">
                      <span>{formatDateDisplay(log.timestamp)}</span>{" "}
                      <span className="text-[11px] opacity-75">{formatTime(log.timestamp)}</span>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-md text-[11px] font-semibold inline-flex items-center gap-1",
                          isUncategorized
                            ? "bg-rose-500/20 text-rose-400"
                            : "bg-primary/10 text-primary"
                        )}
                      >
                        #{log.crimeId} {log.crimeName}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                      {log.action}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-cyan-400 font-semibold">
                      {log.nerve} N
                    </td>
                    <td
                      className={cn(
                        "py-2.5 px-3 text-right font-mono font-bold",
                        isLoss ? "text-rose-400" : "text-emerald-400"
                      )}
                    >
                      {formatMoney(log.value)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 border-t border-border/40 text-xs">
          <span className="text-muted-foreground font-mono">
            Showing Page {pagination.page} of {pagination.totalPages} ({pagination.total.toLocaleString()} total logs)
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={pagination.page <= 1 || isLoading}
              onClick={() => onPageChange(pagination.page - 1)}
              className="p-1.5 rounded-lg border border-border/60 bg-muted/30 hover:bg-muted disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="px-2 font-mono text-foreground font-semibold">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages || isLoading}
              onClick={() => onPageChange(pagination.page + 1)}
              className="p-1.5 rounded-lg border border-border/60 bg-muted/30 hover:bg-muted disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
