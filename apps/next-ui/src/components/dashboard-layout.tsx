"use client";

import React, { useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "./ui/button";
import { useTheme } from "next-themes";
import { Sun, Moon, Palette } from "lucide-react";


export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
            </div >
            {mounted ? (
              <Button variant={"ghost"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="text-zinc-600 ml-auto dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/60" size={"icon"}>
                {theme === "dark" ? (
                  <>
                    <Sun className="size-5 text-amber-500 shrink-0" />
                  </>
                ) : (
                  <>
                    <Moon className="size-5 text-indigo-500 shrink-0" />
                  </>
                )}
              </Button>
            ) : (
              // Stable placeholder prevents SSR mismatch
              <Button
                className="text-zinc-400 opacity-50 pointer-events-none"
              >
                <Palette className="h-5 w-5 shrink-0" />
              </Button>
            )}
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
