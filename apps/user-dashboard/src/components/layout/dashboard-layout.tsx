"use client";

import * as React from "react";
import { DashboardSidebar } from "./dashboard-sidebar";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex flex-col md:flex-row flex-1 p-4 sm:p-6 gap-4 max-w-[1800px] w-full mx-auto">
        <DashboardSidebar />
        <main className="flex-1 min-w-0 rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xs p-4 sm:p-6 lg:p-8 space-y-6 shadow-sm overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
