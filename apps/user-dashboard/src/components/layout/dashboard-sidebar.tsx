"use client";

import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils/cn";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Activity, Terminal } from "lucide-react";

export interface NavItem {
  title: string;
  icon: React.ElementType;
  active?: boolean;
}

export function DashboardSidebar() {
  const mainNav: NavItem[] = [
    { title: "Apps Telemetry", icon: Activity, active: true },
    { title: "Console Logs", icon: Terminal },
  ];

  return (
    <>
      {/* Mobile Top Header (visible on small screens < md) */}
      <div className="md:hidden flex items-center justify-between p-3 rounded-2xl border border-border/70 bg-card backdrop-blur-md mb-3">
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Sentinel Logo"
            width={28}
            height={28}
            className="object-contain rounded-xs"
          />
          <div>
            <h3 className="text-xs font-bold text-foreground tracking-tight leading-none">Sentinel</h3>
          </div>
        </div>
        <ThemeToggle />
      </div>

      {/* Desktop Permanent Sidebar (visible on md+) */}
      <aside className="hidden md:flex flex-col justify-between shrink-0 sticky top-6 w-60 h-[calc(100vh-3rem)] rounded-2xl border border-border/70 bg-card p-4 shadow-sm backdrop-blur-md z-20">
        <div className="flex flex-col gap-5">
          {/* Sidebar Brand / Header */}
          <div className="flex items-center gap-3 px-1 py-0.5 border-b border-border/40 pb-3">
            <Image
              src="/logo.png"
              alt="Sentinel Logo"
              width={28}
              height={28}
              className="object-contain rounded-sm shrink-0"
            />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-foreground tracking-tight truncate">Sentinel</h3>
            </div>
          </div>

          {/* Navigation List */}
          <nav className="flex flex-col gap-1.5">
            {mainNav.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.title}
                  type="button"
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors w-full justify-start cursor-pointer",
                    item.active
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                  title={item.title}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1 text-left truncate">{item.title}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer: ThemeToggle */}
        <div className="pt-3 border-t border-border/40 flex justify-center">
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
