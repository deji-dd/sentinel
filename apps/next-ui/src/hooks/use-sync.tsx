"use client";

import React, { createContext, useContext, useState } from "react";

export interface SyncOption {
  label: string;
  action: () => Promise<void>;
}

export interface LogBackfillProgress {
  status: "in_progress" | "completed" | "error";
  logs_parsed: number;
  oldest_timestamp_reached: number | null;
}

interface SyncContextType {
  syncOptions: SyncOption[] | null;
  setSyncOptions: (options: SyncOption[] | null) => void;
  lastSyncedText: string;
  setLastSyncedText: (text: string) => void;
  isSyncing: boolean;
  setIsSyncing: (syncing: boolean) => void;
  backfillStatus: LogBackfillProgress | null;
  setBackfillStatus: (status: LogBackfillProgress | null) => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [syncOptions, setSyncOptions] = useState<SyncOption[] | null>(null);
  const [lastSyncedText, setLastSyncedText] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [backfillStatus, setBackfillStatus] = useState<LogBackfillProgress | null>(null);

  return (
    <SyncContext.Provider
      value={{
        syncOptions,
        setSyncOptions,
        lastSyncedText,
        setLastSyncedText,
        isSyncing,
        setIsSyncing,
        backfillStatus,
        setBackfillStatus,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const context = useContext(SyncContext);
  if (context === undefined) {
    throw new Error("useSync must be used within a SyncProvider");
  }
  return context;
}
