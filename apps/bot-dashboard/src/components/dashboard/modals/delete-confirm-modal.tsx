"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  isDeleting?: boolean;
}

export function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Delete",
  isDeleting = false,
}: DeleteConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="max-w-md w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-6 mx-4">
        <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
          <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/20 shrink-0">
            <AlertTriangle className="size-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
              {title}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              {description}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1 text-xs font-bold h-10 border-zinc-200 dark:border-zinc-800 cursor-pointer"
          >
            Cancel
          </Button>

          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 text-xs font-bold h-10 bg-red-600 hover:bg-red-700 text-white cursor-pointer shadow-xs gap-1.5"
          >
            {isDeleting ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
