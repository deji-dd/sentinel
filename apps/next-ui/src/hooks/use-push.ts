// src/hooks/use-push.ts
// Hook to manage Web Push subscription state + SW registration.
"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
  // .slice() returns a plain ArrayBuffer, which satisfies BufferSource
  return arr.buffer.slice(0);
}

export function usePush() {
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  // Register SW and check existing subscription on mount
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(async (reg) => {
        setRegistration(reg);
        const existing = await reg.pushManager.getSubscription();
        setSubscribed(!!existing);
      })
      .catch((err) => console.error("[SW] Registration failed:", err));
  }, []);

  const subscribe = useCallback(async () => {
    if (!registration) return;
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY not set");

    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    await fetch("/api/settings/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });

    setSubscribed(true);
  }, [registration]);

  const unsubscribe = useCallback(async () => {
    if (!registration) return;
    const sub = await registration.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
      await fetch("/api/settings/push", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    }
    setSubscribed(false);
  }, [registration]);

  const toggle = useCallback(async () => {
    setLoading(true);
    try {
      if (subscribed) {
        await unsubscribe();
        toast.success("Push alerts disabled");
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast.error("Notifications blocked. Enable them in browser settings.");
          return;
        }
        await subscribe();
        toast.success("Push alerts enabled successfully");
      }
    } catch (err) {
      console.error("[Push] Toggle failed:", err);
      toast.error("Failed to update push notification subscription");
    } finally {
      setLoading(false);
    }
  }, [subscribed, subscribe, unsubscribe]);

  return { subscribed, loading, toggle };
}
