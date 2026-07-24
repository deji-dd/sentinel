"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, ArrowRightLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface CrimeMappingGroup {
  crime_id: number;
  crime_name: string;
  actions: { action: string; log_count: number }[];
}

interface CrimeActionMappingBrowserProps {
  groups: CrimeMappingGroup[];
  allCrimes: { id: number; name: string }[];
  onRemapped: () => void;
}

/**
 * Displays all known action-string → crime mappings grouped by crime.
 * Lets the user reassign any action to a different crime in one click.
 */
export function CrimeActionMappingBrowser({
  groups,
  allCrimes,
  onRemapped,
}: CrimeActionMappingBrowserProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<string | null>(null);

  if (groups.length === 0) return null;

  const toggle = (crimeId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(crimeId)) next.delete(crimeId);
      else next.add(crimeId);
      return next;
    });
  };

  const handleRemap = async (action: string) => {
    const newCrimeId = selections[action];
    if (!newCrimeId) return;
    setLoading(action);
    try {
      const res = await fetch("/api/crimes/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, crime_id: newCrimeId }),
      });
      if (res.ok) onRemapped();
    } catch (e) {
      console.error("Failed to remap action:", e);
    } finally {
      setLoading(null);
    }
  };

  const totalActions = groups.reduce((acc, g) => acc + g.actions.length, 0);

  return (
    <div className="border border-border bg-card">
      {/* Section header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2 font-mono text-foreground text-[10px] uppercase tracking-[0.2em]">
          <ArrowRightLeft size={14} className="text-muted-foreground" />
          ACTION_MAPPING_BROWSER
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-muted-foreground">
            {totalActions} actions across {groups.length} crimes
          </span>
          <button
            onClick={() =>
              setExpanded(
                expanded.size === groups.length
                  ? new Set()
                  : new Set(groups.map((g) => g.crime_id)),
              )
            }
            className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {expanded.size === groups.length ? "COLLAPSE_ALL" : "EXPAND_ALL"}
          </button>
        </div>
      </div>

      <div className="divide-y divide-border">
        {groups.map((group) => {
          const isOpen = expanded.has(group.crime_id);
          return (
            <div key={group.crime_id}>
              {/* Crime group header — clickable to expand */}
              <button
                onClick={() => toggle(group.crime_id)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  {isOpen ? (
                    <ChevronDown size={13} className="text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight size={13} className="text-muted-foreground shrink-0" />
                  )}
                  <span className="font-mono text-sm text-foreground">
                    {group.crime_name}
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] rounded-none border-border text-muted-foreground"
                >
                  {group.actions.length} action{group.actions.length !== 1 ? "s" : ""}
                </Badge>
              </button>

              {/* Action rows */}
              {isOpen && (
                <div className="border-t border-border/50 divide-y divide-border/50">
                  {group.actions.map(({ action, log_count }) => {
                    const isLoading = loading === action;
                    const selectedCrimeId = selections[action];
                    const isDifferent =
                      selectedCrimeId && selectedCrimeId !== group.crime_id;

                    return (
                      <div
                        key={action}
                        className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-2.5 pl-9 bg-background/40"
                      >
                        {/* Action string + count */}
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <span className="font-mono text-xs text-foreground truncate">
                            &quot;{action}&quot;
                          </span>
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px] rounded-none border-border text-muted-foreground shrink-0"
                          >
                            {log_count} log{log_count !== 1 ? "s" : ""}
                          </Badge>
                        </div>

                        {/* Reassign control */}
                        <div className="flex items-center gap-2 shrink-0">
                          <select
                            className="bg-background border border-border text-foreground text-xs p-1.5 font-mono focus:outline-none focus:border-foreground w-52"
                            value={selectedCrimeId ?? group.crime_id}
                            onChange={(e) =>
                              setSelections((prev) => ({
                                ...prev,
                                [action]: parseInt(e.target.value),
                              }))
                            }
                          >
                            {allCrimes.map((crime) => (
                              <option key={crime.id} value={crime.id}>
                                {crime.name}
                              </option>
                            ))}
                          </select>

                          <button
                            onClick={() => handleRemap(action)}
                            disabled={!isDifferent || isLoading}
                            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-border text-muted-foreground hover:text-foreground hover:border-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center gap-1.5"
                          >
                            {isLoading ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <ArrowRightLeft size={12} />
                            )}
                            REMAP
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
