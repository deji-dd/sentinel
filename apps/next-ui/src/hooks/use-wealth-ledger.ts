import { useState, useEffect, useCallback } from 'react';

export interface TransactionItem {
  id: string;
  timestamp: number;
  category: string;
  description: string;
  amount: number;
  cashFlow: number;
}

export interface ActionItem {
  id: string;
  type: string;
  description: string;
  timestamp: number;
}

export interface HistoricalPoint {
  timestamp: number;
  netWorth: number;
  dailyYield: number;
  liquidCash: number;
}

export function useWealthLedger() {
  const [data, setData] = useState<{
    liquidCash: number;
    dailyYield: number;
    recentTransactions: TransactionItem[];
    historical: HistoricalPoint[];
    actionQueue: ActionItem[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [moduleDisabled, setModuleDisabled] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      try {
        let liveData = null;
        try {
          const res = await fetch(`/api/ledger/wealth-state`);
          if (res.ok) liveData = await res.json();
        } catch {
          // Fallback
        }

        if (liveData && mounted) {
          if (liveData.module_disabled) {
            setModuleDisabled(true);
            setIsPolling(false);
            setData(null);
          } else if (liveData.initializing) {
            setModuleDisabled(false);
            setIsPolling(true);
          } else {
            setModuleDisabled(false);
            setIsPolling(false);
            setData(liveData.data || liveData);
          }
        }
      } catch (err) {
        console.error("Failed to load wealth ledger:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    
    let interval: NodeJS.Timeout;
    if (isPolling && mounted) {
      interval = setInterval(fetchData, 2000);
    }
    
    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
    };
  }, [refreshKey, isPolling]);

  return { data, loading, moduleDisabled, isPolling, refetch };
}
