"use client";

import React, { useState } from "react";
import { AlertCircle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  description?: string;
  errorDetails?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Connection Error",
  description = "Failed to load data from the server. Please check your connection and try again.",
  errorDetails,
  onRetry,
}: ErrorStateProps) {
  const [retrying, setRetrying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleRetry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    try {
      onRetry();
    } catch (err) {
      console.error("Retry failed:", err);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex min-h-[350px] flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
      <div className="relative mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 text-rose-500 dark:text-rose-400 shadow-lg shadow-rose-500/5">
        <div className="absolute inset-0 rounded-full bg-rose-500/10 animate-ping opacity-25" />
        <AlertCircle className="h-8 w-8 relative z-10" />
      </div>

      <h3 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </h3>
      <p className="mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        {description}
      </p>

      {onRetry && (
        <Button
          onClick={handleRetry}
          disabled={retrying}
          className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 dark:bg-amber-500 dark:hover:bg-amber-600 text-zinc-950 font-semibold px-6 shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
          {retrying ? "Connecting..." : "Try Again"}
        </Button>
      )}

      {errorDetails && (
        <div className="mt-8 w-full max-w-md border border-zinc-150 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-950/30 rounded-xl overflow-hidden backdrop-blur-sm">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100/50 dark:hover:bg-zinc-900/20 transition-colors"
          >
            <span>Technical Details</span>
            {showDetails ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {showDetails && (
            <div className="border-t border-zinc-150 dark:border-zinc-900 px-4 py-3 text-left">
              <pre className="font-mono text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-400 overflow-x-auto whitespace-pre-wrap max-h-32">
                {errorDetails}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
