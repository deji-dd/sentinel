"use client";

import React from "react";
import { useSettings } from "./settings-provider";
import { ServerCrash } from "lucide-react";

export function ModuleGuard({ children }: { children: React.ReactNode }) {
  const { settings, isLoading } = useSettings();

  if (isLoading) {
    return null; // or a subtle loading state
  }

  if (!settings.log_manager_enabled) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-[80vh] text-center p-8">
        <ServerCrash size={32} className="text-red-500 mb-6" />
        <div className="text-red-500 font-mono tracking-widest text-sm mb-4 uppercase">
          [ LOG_MANAGER_DISABLED ]
        </div>
        <div className="text-neutral-500 font-mono text-xs uppercase tracking-widest max-w-md leading-relaxed">
          This module requires the Log Manager Engine to be online to intercept and process events. Access the System Settings in the Overview terminal to enable it.
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
