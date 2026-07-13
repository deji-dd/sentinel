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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
          {/* Dynamic Island Header */}
          <div className="sticky top-[max(env(safe-area-inset-top),1rem)] z-30 flex justify-center w-full px-4 pointer-events-none mb-4">
            <header className="pointer-events-auto flex shrink-0 items-center justify-between h-14 px-6 gap-6 rounded-full border border-zinc-200/50 dark:border-white/10 bg-white/60 backdrop-blur-2xl dark:bg-zinc-900/60 shadow-[0_20px_40px_rgba(0,0,0,0.1)] transition-all duration-300">
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
            </header>
          </div>

          {/* Viewport Content Area */}
          <div className="flex-1 p-4 md:p-8 outline-none relative z-10">
            <div className="mx-auto max-w-7xl w-full">
              {children}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
  );
}

