"use client";

import * as React from "react";
import { DashboardSidebar, type DashboardTab } from "@/components/layout/dashboard-sidebar";
import { LiveTelemetryDashboard } from "@/components/telemetry/live-telemetry-dashboard";
import { PersonalLogsDashboard } from "@/components/personal-logs/personal-logs-dashboard";

export default function DashboardPage() {
  const [activeTab, setActiveTab] = React.useState<DashboardTab>("telemetry");

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Main Container: Sidebar + Active Dashboard View */}
      <div className="flex flex-col md:flex-row flex-1 p-4 sm:p-6 gap-4 max-w-[1800px] w-full mx-auto">
        {/* Navigation Sidebar */}
        <DashboardSidebar activeTab={activeTab} onSelectTab={setActiveTab} />

        {/* Main Workspace View */}
        <main className="flex-1 min-w-0 rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xs p-4 sm:p-6 lg:p-8 space-y-6 shadow-sm overflow-y-auto">
          {activeTab === "telemetry" && <LiveTelemetryDashboard />}
          {activeTab === "personal-logs" && <PersonalLogsDashboard />}
        </main>
      </div>
    </div>
  );
}
