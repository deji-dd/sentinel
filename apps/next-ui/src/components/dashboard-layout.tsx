"use client";

import React, { useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { RefreshCw, ChevronDown, Sun, Moon } from "lucide-react";
import { useSync } from "@/hooks/use-sync";
import { useTheme } from "next-themes";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const { syncOptions, lastSyncedText, isSyncing, setIsSyncing } = useSync();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="bg-background text-foreground">
        <div className="sticky top-0 z-30 flex justify-center w-full pointer-events-none">
          <header className="pointer-events-auto flex w-full shrink-0 items-center justify-between pt-[env(safe-area-inset-top)] px-4 pb-3 sm:pb-4 md:px-8 border-b border-border bg-background/80 backdrop-blur-md">
            <div className="flex gap-4 items-center">
              <SidebarTrigger className="text-neutral-500 hover:text-white transition-colors" />
              <div className="w-px h-4 bg-neutral-900" />
              {mounted && lastSyncedText && (
                <span className="text-[10px] hidden sm:block text-neutral-500 font-mono uppercase tracking-[0.2em] select-none">
                  {lastSyncedText}
                </span>
              )}
            </div >

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
                      className="text-[10px] font-mono tracking-[0.2em] uppercase text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
                      disabled={isSyncing}
                    >
                      <RefreshCw className={`size-4 ${isSyncing ? "animate-spin text-white" : ""}`} />
                      <span className="hidden sm:inline">SYNC</span>
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className="text-[10px] font-mono tracking-[0.2em] uppercase text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
                        disabled={isSyncing}
                      >
                        <RefreshCw className={`size-4 ${isSyncing ? "animate-spin text-white" : ""}`} />
                        <span className="hidden sm:inline">SYNC</span>
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
                className="ml-2 p-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
