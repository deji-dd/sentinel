"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangle, Trash2 } from "lucide-react";

interface DeinitializeModalProps {
  showDeinitModal: boolean;
  setShowDeinitModal: (val: boolean) => void;
  deinitializing: boolean;
  handleDeinitializeGuild: () => void;
}

/**
 * Modal to confirm guild deinitialization and configuration wipe.
 */
export function DeinitializeModal({
  showDeinitModal,
  setShowDeinitModal,
  deinitializing,
  handleDeinitializeGuild,
}: DeinitializeModalProps) {
  if (!showDeinitModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="max-w-md w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-850 rounded-2xl p-6 shadow-2xl space-y-6 mx-4">
        <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
          <div className="p-3 rounded-full bg-red-500/10 border border-red-500/20">
            <AlertTriangle className="size-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">Deinitialize Guild?</h3>
            <p className="text-xs text-zinc-500">This action cannot be undone.</p>
          </div>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Deinitializing will permanently delete all stored settings, role mappings, API keys, and module choices for this Discord server.
        </p>

        <div className="flex gap-3 justify-end pt-2">
          <Button
            variant="ghost"
            onClick={() => setShowDeinitModal(false)}
            disabled={deinitializing}
            className="font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-white cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDeinitializeGuild}
            disabled={deinitializing}
            className="bg-red-600 hover:bg-red-700 text-white font-bold px-5 rounded-xl cursor-pointer"
          >
            <Trash2 className="size-4 mr-2" />
            {deinitializing ? "Deinitializing..." : "Yes, Deinitialize"}
          </Button>
        </div>
      </div>
    </div>
  );
}
