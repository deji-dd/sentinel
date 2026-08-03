"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Layers, Tag, Edit3, CheckCircle2, AlertTriangle, Zap, Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface ActionBreakdownItem {
  action: string;
  count: number;
  totalNerve: number;
  totalProfit: number;
  profitPerNerve: number;
  isCustomMapped: boolean;
}

export interface CrimeCategoryBreakdown {
  crimeId: number;
  crimeName: string;
  totalProfit: number;
  totalNerve: number;
  totalLogs: number;
  actions: ActionBreakdownItem[];
}

interface CrimesCategoryBreakdownProps {
  categories: CrimeCategoryBreakdown[];
  onCategorizeAction: (action: string, targetCrimeId: number) => Promise<void>;
  isLoading?: boolean;
}

function formatMoney(amount: number): string {
  const isNegative = amount < 0;
  const absVal = Math.abs(amount);
  let formatted = "";
  if (absVal >= 1_000_000_000) {
    formatted = `$${(absVal / 1_000_000_000).toFixed(2)}B`;
  } else if (absVal >= 1_000_000) {
    formatted = `$${(absVal / 1_000_000).toFixed(2)}M`;
  } else if (absVal >= 1_000) {
    formatted = `$${(absVal / 1_000).toFixed(1)}k`;
  } else {
    formatted = `$${absVal.toLocaleString()}`;
  }
  return isNegative ? `-${formatted}` : formatted;
}

export function CrimesCategoryBreakdownView({
  categories,
  onCategorizeAction,
  isLoading,
}: CrimesCategoryBreakdownProps) {
  const [mounted, setMounted] = React.useState(false);
  const [expandedCategories, setExpandedCategories] = React.useState<Record<number, boolean>>({
    0: true, // Default expand Uncategorized if present
  });

  const [editingAction, setEditingAction] = React.useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = React.useState<number>(1);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [filterQuery, setFilterQuery] = React.useState<string>("");

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Disable background scroll on modal open
  React.useEffect(() => {
    if (editingAction) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [editingAction]);

  const toggleCategory = (crimeId: number) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [crimeId]: !prev[crimeId],
    }));
  };

  const handleOpenCategorizeModal = (action: string, currentCrimeId: number) => {
    setEditingAction(action);
    setSelectedTargetId(currentCrimeId === 0 ? 1 : currentCrimeId);
  };

  const handleSaveCategorization = async () => {
    if (!editingAction) return;
    setIsSubmitting(true);
    try {
      await onCategorizeAction(editingAction, selectedTargetId);
      toast.success(`Action "${editingAction}" mapped successfully!`);
      setEditingAction(null);
    } catch (err) {
      toast.error(`Categorization failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter categories by query
  const filteredCategories = categories
    .map((cat) => {
      if (!filterQuery.trim()) return cat;
      const q = filterQuery.toLowerCase().trim();
      const matchesCategory = cat.crimeName.toLowerCase().includes(q);
      const matchingActions = cat.actions.filter((a) => a.action.toLowerCase().includes(q));

      if (matchesCategory || matchingActions.length > 0) {
        return {
          ...cat,
          actions: matchesCategory ? cat.actions : matchingActions,
        };
      }
      return null;
    })
    .filter((c): c is CrimeCategoryBreakdown => c !== null);

  const modalContent =
    editingAction && mounted ? (
      <div className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-md rounded-2xl border border-border/80 bg-card p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <h4 className="text-sm font-bold text-foreground">Categorize Crime Action</h4>
            <button
              type="button"
              onClick={() => setEditingAction(null)}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Action String</label>
              <div className="mt-1.5 p-3 rounded-xl border border-border/60 bg-muted/40 text-xs font-mono font-bold text-foreground break-all">
                {editingAction}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground">Target Crime Category</label>
              <select
                value={selectedTargetId}
                onChange={(e) => setSelectedTargetId(Number(e.target.value))}
                className="mt-1.5 w-full h-10 px-3 text-xs font-semibold text-foreground bg-background border border-border/80 rounded-xl shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
              >
                {categories
                  .filter((c) => c.crimeId !== 0)
                  .map((cat) => (
                    <option key={cat.crimeId} value={cat.crimeId}>
                      #{cat.crimeId} - {cat.crimeName}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/40">
            <button
              type="button"
              onClick={() => setEditingAction(null)}
              className="px-4 py-2 rounded-xl border border-border/70 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSaveCategorization}
              className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer transition-opacity shadow-xs"
            >
              {isSubmitting ? "Saving..." : "Save & Map Action"}
            </button>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5 space-y-5 shadow-sm">
      {/* Header & Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Layers className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Category & Action Verification</h3>

          </div>
        </div>

        {/* Search / Filter Input */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter actions or categories..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-border/60 bg-muted/30 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Category Accordion List */}
      <div className="space-y-3">
        {filteredCategories.map((cat) => {
          const isExpanded = !!expandedCategories[cat.crimeId];
          const isUncategorized = cat.crimeId === 0;
          const hasActions = cat.actions.length > 0;

          return (
            <div
              key={cat.crimeId}
              className={cn(
                "rounded-xl border transition-all overflow-hidden",
                isUncategorized && hasActions
                  ? "border-rose-500/40 bg-rose-950/10 dark:bg-rose-950/20"
                  : "border-border/60 bg-muted/20 hover:border-border"
              )}
            >
              {/* Category Header Bar */}
              <button
                type="button"
                onClick={() => toggleCategory(cat.crimeId)}
                className="w-full flex items-center justify-between p-3.5 text-left cursor-pointer hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {isExpanded ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  )}

                  <div className="flex items-center gap-2 truncate">
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-md text-[11px] font-mono font-bold shrink-0",
                        isUncategorized ? "bg-rose-500/20 text-rose-400" : "bg-primary/20 text-primary"
                      )}
                    >
                      #{cat.crimeId}
                    </span>
                    <span className="font-bold text-sm text-foreground truncate">{cat.crimeName}</span>

                    {isUncategorized && hasActions && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400">
                        <AlertTriangle className="size-3" />
                        {cat.actions.length} action(s) need categorization
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0 text-xs font-mono">
                  <span className="text-muted-foreground hidden sm:inline">
                    {cat.totalLogs.toLocaleString()} logs
                  </span>
                  <span className="text-muted-foreground hidden sm:inline">
                    {cat.totalNerve.toLocaleString()} N
                  </span>
                  <span
                    className={cn(
                      "font-bold",
                      cat.totalProfit < 0 ? "text-rose-400" : "text-emerald-400"
                    )}
                  >
                    {formatMoney(cat.totalProfit)}
                  </span>
                </div>
              </button>

              {/* Category Actions Table */}
              {isExpanded && (
                <div className="border-t border-border/40 p-3 bg-card/60">
                  {cat.actions.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic py-3 text-center">
                      No logged actions under this category.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-border/40 text-muted-foreground font-semibold">
                            <th className="py-2 px-3">Action String</th>
                            <th className="py-2 px-3 text-right">Executions</th>
                            <th className="py-2 px-3 text-right">Total Nerve</th>
                            <th className="py-2 px-3 text-right font-mono">Profit / Nerve</th>
                            <th className="py-2 px-3 text-right font-mono">Total Profit</th>
                            <th className="py-2 px-3 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {cat.actions.map((act) => (
                            <tr key={act.action} className="hover:bg-muted/30 transition-colors">
                              <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                                <div className="flex items-center gap-2">
                                  <span>{act.action}</span>
                                  {act.isCustomMapped && (
                                    <span
                                      className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-sans"
                                      title="Custom User Mapped"
                                    >
                                      Custom
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                                {act.count.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                                {act.totalNerve.toLocaleString()} N
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-cyan-400 font-semibold">
                                ${act.profitPerNerve.toLocaleString()}
                              </td>
                              <td
                                className={cn(
                                  "py-2.5 px-3 text-right font-mono font-semibold",
                                  act.totalProfit < 0 ? "text-rose-400" : "text-emerald-400"
                                )}
                              >
                                {formatMoney(act.totalProfit)}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleOpenCategorizeModal(act.action, cat.crimeId)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/80 bg-muted/50 hover:bg-primary hover:text-primary-foreground hover:border-primary text-[11px] font-medium transition-colors cursor-pointer"
                                >
                                  <Edit3 className="size-3" />
                                  <span>Re-categorize</span>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Render full-page modal using React Portal */}
      {modalContent && createPortal(modalContent, document.body)}
    </div>
  );
}
