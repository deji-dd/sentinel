"use client";

import React, { createContext, useContext, useState } from "react";

export interface SyncOption {
  label: string;
  action: () => Promise<void>;
}

interface SyncContextType {
  syncOptions: SyncOption[] | null;
  setSyncOptions: (options: SyncOption[] | null) => void;
  lastSyncedText: string;
  setLastSyncedText: (text: string) => void;
  isSyncing: boolean;
  setIsSyncing: (syncing: boolean) => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [syncOptions, setSyncOptions] = useState<SyncOption[] | null>(null);
  const [lastSyncedText, setLastSyncedText] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  return (
    <SyncContext.Provider
      value={{
        syncOptions,
        setSyncOptions,
        lastSyncedText,
        setLastSyncedText,
        isSyncing,
        setIsSyncing,
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
