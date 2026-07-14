"use client";

import React from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { usePush } from "@/hooks/use-push";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, Settings, Database } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import GlobalLoading from "@/components/dashboard/GlobalLoading";
import { useMinimumLoading } from "@/hooks/use-minimum-loading";

export default function SettingsPage() {
  const { subscribed, loading, toggle } = usePush();

  const showLoader = useMinimumLoading(loading, 2000);

  const handleReinitLedger = async (ledger: "gym" | "items" | "crimes" | "war") => {
    try {
      const res = await fetch("/api/ledger/reinit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ledger }),
      });
      if (res.ok) {
        toast.success(`Successfully requested ${ledger} ledger re-initialization`);
      } else {
        toast.error(`Failed to re-initialize ${ledger} ledger`);
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      toast.error(`An error occurred while re-initializing ${ledger} ledger`);
    }
  };

  if (showLoader) {
    return (
      <DashboardLayout>
        <GlobalLoading />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-8 max-w-4xl mx-auto min-h-screen pt-20">
        <div className="flex items-center gap-4 mb-12">
          <div className="dashboard-title">
            <h1 className="text-4xl font-black tracking-tighter text-zinc-900 dark:text-zinc-50 flex items-center gap-3">
              <Settings className="w-10 h-10" />
              Settings
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 mt-2">
              Manage your notifications and system preferences.
            </p>
          </div>
        </div>

        <div className="space-y-8">
          {/* Push Notifications Card */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
                  {subscribed ? <Bell size={24} /> : <BellOff size={24} />}
                </div>
                <div>
                  <h2 className="text-xl font-bold">Push Notifications</h2>
                  <p className="text-sm text-zinc-400">Receive real-time alerts even when the app is closed.</p>
                </div>
              </div>

              <div className="flex items-center justify-between p-6 bg-white/5 dark:bg-black/20 rounded-xl border border-zinc-200 dark:border-white/5">
                <div>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">Status</p>
                  <p className="text-sm text-zinc-500 flex items-center gap-2 mt-1">
                    <span className="relative flex h-2 w-2">
                      {subscribed && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${subscribed ? 'bg-emerald-500' : 'bg-zinc-500'}`}></span>
                    </span>
                    {subscribed ? "Active" : "Inactive"}
                  </p>
                </div>
                <Button
                  onClick={toggle}
                  disabled={loading}
                  className={subscribed ? "bg-red-500 hover:bg-red-600 text-white" : "bg-indigo-500 hover:bg-indigo-600 text-white"}
                >
                  {loading
                    ? "Loading..."
                    : subscribed
                      ? "Disable Notifications"
                      : "Enable Notifications"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Ledger Re-Initialization */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-red-500/20 text-red-400 rounded-lg">
                  <Database size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Ledger Re-Initialization</h2>
                  <p className="text-sm text-zinc-500">Recalculate historical data</p>
                </div>
              </div>
              <div className="space-y-4">
                {[
                  { id: "gym", title: "Gym Ledger" },
                  { id: "items", title: "Items Ledger" },
                  { id: "crimes", title: "Crimes Ledger" },
                  { id: "war", title: "Territory War Ledger" },
                ].map((ledger) => (
                  <div key={ledger.id} className="flex items-center justify-between p-4 bg-white/5 dark:bg-black/20 rounded-xl border border-zinc-200 dark:border-white/5 transition-colors">
                    <div>
                      <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{ledger.title}</h3>
                      <p className="text-sm text-zinc-500">Delete all existing records and rebuild from raw logs</p>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger className={buttonVariants({ variant: "destructive", size: "sm" })}>
                        Re-Initialize
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will delete the current {ledger.title} state and recalculate it from all logs.
                            The dashboard may be inaccurate while the ledger backfills.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-500 hover:bg-red-600"
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            onClick={() => handleReinitLedger(ledger.id as any)}
                          >
                            Continue
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
