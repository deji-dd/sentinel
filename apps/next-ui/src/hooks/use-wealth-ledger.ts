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
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
        
        // In a real scenario, we would await fetch calls here.
        // For now, if endpoints don't exist, we fallback to mock data.
        let liveData = null;
        try {
          const res = await fetch(`${apiUrl}/api/ledger/wealth-state`, { signal: AbortSignal.timeout(1000) });
          if (res.ok) liveData = await res.json();
        } catch (e) {
          // Fallback
        }

        if (liveData && mounted) {
          setData(liveData);
        } else if (mounted) {
          // Mock data
          setData({
            liquidCash: 1250000000,
            dailyYield: 45000000,
            recentTransactions: [
              { id: "1", timestamp: Date.now() - 3600000, category: "sale", description: "Sold 50x Feathery Hotel Coupon", amount: 725000000, cashFlow: 725000000 },
              { id: "2", timestamp: Date.now() - 7200000, category: "purchase", description: "Bought 5000x Xanax", amount: 0, cashFlow: -4175000000 },
              { id: "3", timestamp: Date.now() - 86400000, category: "income", description: "Company Daily Wage", amount: 2500000, cashFlow: 2500000 },
            ],
            historical: Array.from({ length: 30 }).map((_, i) => ({
              timestamp: Date.now() - (29 - i) * 86400000,
              netWorth: 6000000000 + Math.random() * 500000000 + i * 20000000,
              liquidCash: 1000000000 + Math.random() * 200000000,
            })),
            actionQueue: [
              { id: "tx_123", type: "Barter Trade", description: "Traded 5x Xanax for 1x FHC", timestamp: Date.now() - 3600000 },
              { id: "tx_124", type: "Unique Item", description: "Found 'Golden M4A1' in City", timestamp: Date.now() - 7200000 },
            ]
          });
        }
      } catch (err) {
        console.error("Failed to load wealth ledger:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  return { data, loading, refetch };
}
