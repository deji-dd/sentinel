"use client";

import { useEffect, useTransition } from "react";
import { ServerCrash, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // Log the error to an error reporting service
    console.error("TT Selector Route Error:", error);
  }, [error]);

  const isNetworkError =
    error.message.includes("fetch failed") ||
    error.message.includes("ECONNREFUSED") ||
    error.message.includes("Failed to fetch");

  const [isPending, startTransition] = useTransition();

  const handleRetry = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <div className="min-h-screen w-full bg-zinc-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background ambient effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-900/20 via-zinc-950 to-zinc-950 z-0" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-500/5 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-lg w-full">
        <div className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800/50 rounded-2xl p-8 shadow-2xl flex flex-col items-center text-center">
          <div className="h-20 w-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6 ring-1 ring-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.15)]">
            <ServerCrash className="h-10 w-10 text-red-400" />
          </div>

          <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">
            {isNetworkError ? "API Connection Failed" : "Something went wrong"}
          </h1>

          <p className="text-zinc-400 mb-8 leading-relaxed max-w-[320px]">
            {isNetworkError
              ? "We couldn't reach the Sentinel API Gateway."
              : "An unexpected error occurred while loading the territory selector. Our systems have logged the fault."}
          </p>

          <div className="bg-zinc-950/50 border border-zinc-800/50 rounded-lg p-4 w-full mb-8 overflow-hidden text-left">
            <p className="text-xs font-mono text-zinc-500 truncate">
              ERR_CODE: {error.digest || "UNKNOWN_FAULT"}
            </p>
            <p className="text-xs font-mono text-red-400/80 mt-1 truncate">
              {error.message}
            </p>
          </div>

          <Button
            onClick={handleRetry}
            disabled={isPending}
            className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all hover:shadow-[0_0_20px_rgba(239,68,68,0.2)]"
          >
            <RefreshCcw className={`mr-2 h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
            {isPending ? "Reconnecting..." : "Attempt Reconnection"}
          </Button>
        </div>
      </div>
    </div>
  );
}
