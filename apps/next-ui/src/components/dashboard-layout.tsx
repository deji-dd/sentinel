"use client";

import React, { useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "./ui/button";
import { useTheme } from "next-themes";
import { Sun, Moon, Palette, RefreshCw, ChevronDown } from "lucide-react";
import { useSync } from "@/hooks/use-sync";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { syncOptions, lastSyncedText, isSyncing, setIsSyncing } = useSync();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="flex flex-col flex-1 min-h-0 bg-zinc-50 dark:bg-zinc-950">
        {/* Top Header */}
        <header className="sticky top-0 z-20 flex flex-col w-full shrink-0 border-b border-zinc-200 dark:border-zinc-900 bg-white/80 backdrop-blur-md dark:bg-zinc-950/80">
          <div className="w-full h-[env(safe-area-inset-top)] shrink-0" />
          <div className="flex h-16 items-center justify-between px-4 shrink-0">
            <div className="flex gap-2 items-center">
              <SidebarTrigger className="text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/60" />
              <Separator orientation="vertical" className="h-11 my-auto" />
              {mounted && lastSyncedText && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono select-none ml-1">
                  {lastSyncedText}
                </span>
              )}
            </div >

            <div className="flex items-center gap-2 ml-auto">
              {mounted && syncOptions && syncOptions.length > 0 && (
                <div className="relative">
                  {syncOptions.length === 1 ? (
                    <Button
                      variant="ghost"
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
                      className="text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/60 flex items-center gap-1.5 px-3"
                      disabled={isSyncing}
                      size="sm"
                    >
                      <RefreshCw className={`size-4 ${isSyncing ? "animate-spin text-emerald-500" : ""}`} />
                      <span className="text-xs font-medium hidden sm:inline">Sync</span>
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className="text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/60 flex items-center gap-1 px-3"
                        disabled={isSyncing}
                        size="sm"
                      >
                        <RefreshCw className={`size-4 mr-0.5 ${isSyncing ? "animate-spin text-emerald-500" : ""}`} />
                        <span className="text-xs font-medium hidden sm:inline">Sync</span>
                        <ChevronDown className="size-3.5 opacity-60 ml-0.5" />
                      </Button>
                      {dropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setDropdownOpen(false)} />
                          <div className="absolute right-0 mt-1.5 w-52 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 shadow-lg backdrop-blur-md z-40 py-1.5 flex flex-col gap-0.5">
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
                                className="w-full text-left px-3.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900/60 transition-colors"
                              >
                                {opt.label}
                              </button>
                            ))}
                            <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-1" />
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
                              className="w-full text-left px-3.5 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                            >
                              Sync All
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {mounted ? (
                <Button variant={"ghost"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  className="text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/60" size={"icon"}>
                  {theme === "dark" ? (
                    <Sun className="size-5 text-amber-500 shrink-0" />
                  ) : (
                    <Moon className="size-5 text-indigo-500 shrink-0" />
                  )}
                </Button>
              ) : (
                <Button
                  className="text-zinc-400 opacity-50 pointer-events-none"
                  size="icon"
                  variant="ghost"
                >
                  <Palette className="h-5 w-5 shrink-0" />
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* Viewport Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 outline-none">
          <div className="mx-auto max-w-7xl w-full">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

