"use client";

import React, { useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

interface UnmappedCrimesProps {
  unmappedActions: string[];
  allCrimes: { id: number; name: string }[];
  onMapped: () => void;
}

export function UnmappedCrimes({
  unmappedActions,
  allCrimes,
  onMapped,
}: UnmappedCrimesProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, number>>({});

  const handleMap = async (action: string) => {
    const crimeId = selections[action];
    if (!crimeId) return;

    setLoading(action);
    try {
      const res = await fetch("/api/crimes/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, crime_id: crimeId }),
      });
      if (res.ok) {
        onMapped();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  if (unmappedActions.length === 0) return null;

  return (
    <div className="border border-red-900/50 bg-red-950/10 p-6 mb-6">
      <div className="flex items-center gap-2 font-mono text-red-500 text-[10px] uppercase tracking-[0.2em] mb-4">
        <AlertTriangle size={16} /> UNMAPPED_ACTIONS_DETECTED
      </div>
      <p className="text-muted-foreground font-mono text-xs mb-6">
        The system detected crime logs with actions it could not automatically
        categorize. Please map them to the correct crime. Once mapped, the
        system will remember and automatically categorize them in the future.
      </p>

      <div className="space-y-4">
        {unmappedActions.map((action) => (
          <div
            key={action}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-border bg-card/50"
          >
            <div className="font-mono text-sm text-foreground">
              <span className="text-muted-foreground mr-2">ACTION:</span>
              &quot;{action}&quot;
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                className="w-full sm:w-64 bg-background border border-border text-foreground text-sm p-2 font-mono focus:outline-none focus:border-foreground"
                value={selections[action] || ""}
                onChange={(e) =>
                  setSelections({
                    ...selections,
                    [action]: parseInt(e.target.value),
                  })
                }
              >
                <option value="" disabled>
                  Select Crime...
                </option>
                {allCrimes.map((crime) => (
                  <option key={crime.id} value={crime.id}>
                    {crime.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => handleMap(action)}
                disabled={!selections[action] || loading === action}
                className="bg-foreground text-background p-2 disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                {loading === action ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <Check size={20} />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
