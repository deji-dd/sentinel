"use client";

import React, { useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { usePathname } from "next/navigation";
import { RefreshCw, ChevronDown, Sun, Moon } from "lucide-react";
import { useSync } from "@/hooks/use-sync";
import { useTheme } from "next-themes";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const { syncOptions, lastSyncedText, isSyncing, setIsSyncing, backfillStatus } = useSync();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const pathname = usePathname();
  const isOverview = pathname === "/";
  const isBackfillInProgress = mounted && backfillStatus?.status === "in_progress";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return "LATEST";
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(timestamp * 1000));
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="bg-background text-foreground">
        <div className="sticky top-0 z-30 flex justify-center w-full pointer-events-none">
          <header className="pointer-events-auto flex w-full shrink-0 items-center justify-between pt-[env(safe-area-inset-top)] px-4 pb-3 sm:py-2 md:px-8 border-b border-border bg-background/80 backdrop-blur-md">
            <div className="flex gap-4 items-center">
              <SidebarTrigger className="text-neutral-500 hover:text-white transition-colors" />
              <div className="w-px h-4 bg-neutral-900" />
              {mounted && backfillStatus && backfillStatus.status === "in_progress" ? (
                <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-sm text-amber-500 font-mono text-[10px] uppercase tracking-wider animate-pulse">
                  <span>[ BACKFILL IN PROGRESS:</span>
                  <span className="font-bold">{backfillStatus.logs_parsed.toLocaleString()} LOGS</span>
                  <span className="text-amber-500/60">•</span>
                  <span>REACHED: {formatDate(backfillStatus.oldest_timestamp_reached)} ]</span>
                </div>
              ) : (
                mounted && lastSyncedText && (
                  <span className="text-[10px] hidden sm:block text-neutral-500 font-mono uppercase tracking-[0.2em] select-none">
                    {lastSyncedText}
                  </span>
                )
              )}
            </div>

            <div className="flex items-center gap-4 ml-auto">
              {mounted && syncOptions && syncOptions.length > 0 && (
                <div className="relative">
                  {syncOptions.length === 1 ? (
                    <button
                      onClick={async () => {
                        if (isSyncing) return;
                        setIsSyncing(true);
                        try {
                          await syncOptions[0].action();
                        } catch (err) {
                          console.error(err);
                        } finally {
                          setIsSyncing(false);
                        }
                      }}
                      className="text-[10px] cursor-pointer font-mono tracking-[0.2em] uppercase text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                      disabled={isSyncing}
                    >
                      <RefreshCw className={`size-4 ${isSyncing ? "animate-spin text-primary" : ""}`} />
                      <span className="hidden sm:inline">{isSyncing ? "SYNCING..." : "SYNC"}</span>
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className="text-[10px] cursor-pointer font-mono tracking-[0.2em] uppercase text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                        disabled={isSyncing}
                      >
                        <RefreshCw className={`size-4 ${isSyncing ? "animate-spin text-primary" : ""}`} />
                        <span className="hidden sm:inline">{isSyncing ? "SYNCING..." : "SYNC"}</span>
                        <ChevronDown className="size-4 opacity-50" />
                      </button>
                      {dropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setDropdownOpen(false)} />
                          <div className="absolute right-0 mt-4 w-48 border border-border bg-background z-40 flex flex-col">
                            {syncOptions.map((opt) => (
                              <button
                                key={opt.label}
                                onClick={async () => {
                                  setDropdownOpen(false);
                                  setIsSyncing(true);
                                  try {
                                    await opt.action();
                                  } catch (err) {
                                    console.error(err);
                                  } finally {
                                    setIsSyncing(false);
                                  }
                                }}
                                className="w-full text-left px-4 py-3 text-[10px] font-mono tracking-[0.2em] uppercase text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                              >
                                {opt.label}
                              </button>
                            ))}
                            <div className="h-px bg-border" />
                            <button
                              onClick={async () => {
                                setDropdownOpen(false);
                                setIsSyncing(true);
                                try {
                                  await Promise.all(syncOptions.map(opt => opt.action()));
                                } catch (err) {
                                  console.error(err);
                                } finally {
                                  setIsSyncing(false);
                                }
                              }}
                              className="w-full text-left px-4 py-3 text-[10px] font-mono tracking-[0.2em] uppercase text-foreground hover:bg-accent transition-colors"
                            >
                              SYNC_ALL
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Theme toggle — far right */}
            {mounted && (
              <button
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                className="ml-2 p-2 cursor-pointer text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {resolvedTheme === "dark"
                  ? <Sun className="size-4" />
                  : <Moon className="size-4" />}
              </button>
            )}
          </header>

        </div>

        {/* Viewport Content Area */}
        <div className="flex-1 outline-none relative z-10 w-full">
          {isBackfillInProgress && !isOverview ? (
            <div className="max-w-4xl p-8 mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center gap-6 pt-20">
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-500 animate-pulse">
                <RefreshCw className="size-10 animate-spin" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-mono text-foreground uppercase tracking-[0.2em]">
                  MODULE INITIALIZATION IN PROGRESS
                </h2>
                <p className="text-sm font-mono text-muted-foreground uppercase tracking-widest max-w-lg mx-auto">
                  Historical log backfill is currently ongoing. Modules will automatically unlock once the historical sync is completed.
                </p>
              </div>
              {backfillStatus && (
                <div className="border border-border bg-card p-4 rounded-none font-mono text-xs text-muted-foreground flex flex-col gap-1 uppercase tracking-widest min-w-[280px]">
                  <div>LOGS PARSED: <span className="text-foreground font-bold">{backfillStatus.logs_parsed.toLocaleString()}</span></div>
                  <div>DATE REACHED: <span className="text-foreground font-bold">{formatDate(backfillStatus.oldest_timestamp_reached)}</span></div>
                </div>
              )}
            </div>
          ) : (
            children
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
