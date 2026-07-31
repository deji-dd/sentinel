"use client";

import { useEffect } from "react";
import { toast } from "sonner";

interface ToastNotifierProps {
  message?: string | null;
  type?: "error" | "success" | "info" | "warning";
}

export function ToastNotifier({ message, type = "error" }: ToastNotifierProps) {
  useEffect(() => {
    if (!message) return;

    if (type === "error") {
      toast.error(message);
    } else if (type === "success") {
      toast.success(message);
    } else if (type === "warning") {
      toast.warning(message);
    } else {
      toast.info(message);
    }
  }, [message, type]);

  return null;
}
