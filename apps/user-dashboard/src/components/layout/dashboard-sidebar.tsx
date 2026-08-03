"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Activity, FileText, Target } from "lucide-react";

export interface NavItem {
  id: string;
  title: string;
  href: string;
  icon: React.ElementType;
}

export function DashboardSidebar() {
  const pathname = usePathname();

  const mainNav: NavItem[] = [
    { id: "telemetry", title: "Apps Telemetry", href: "/telemetry", icon: Activity },
    { id: "personal-logs", title: "Personal Logs", href: "/personal-logs", icon: FileText },
    { id: "crimes", title: "Crimes Analytics", href: "/crimes", icon: Target },
  ];

  return (
    <>
      {/* Mobile Top Header (visible on small screens < md) */}
      <div className="md:hidden flex flex-col gap-2 p-3 rounded-2xl border border-border/70 bg-card backdrop-blur-md mb-3">
        <div className="flex items-center justify-between">
          <Link href="/telemetry" className="flex items-center gap-2.5 cursor-pointer">
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
          </Link>
          <ThemeToggle />
        </div>

        {/* Mobile Navigation Links */}
        <div className="flex items-center gap-1.5 pt-1 border-t border-border/40 overflow-x-auto">
          {mainNav.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (pathname === "/" && item.href === "/telemetry");
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap cursor-pointer",
                  isActive
                    ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                    : "bg-muted/60 text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span>{item.title}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Desktop Permanent Sidebar (visible on md+) */}
      <aside className="hidden md:flex flex-col justify-between shrink-0 sticky top-6 w-60 h-[calc(100vh-3rem)] rounded-2xl border border-border/70 bg-card p-4 shadow-sm backdrop-blur-md z-20">
        <div className="flex flex-col gap-5">
          {/* Sidebar Brand / Header */}
          <Link href="/telemetry" className="flex items-center gap-3 px-1 py-0.5 border-b border-border/40 pb-3 cursor-pointer">
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
          </Link>

          {/* Navigation List */}
          <nav className="flex flex-col gap-1.5">
            {mainNav.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || (pathname === "/" && item.href === "/telemetry");
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors w-full justify-start cursor-pointer",
                    isActive
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                  title={item.title}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1 text-left truncate">{item.title}</span>
                </Link>
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
