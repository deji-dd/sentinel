"use client";

import * as React from "react";
import Image from "next/image";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  Bell,
  Search,
  Zap,
  User,
  Sliders,
} from "lucide-react";

export function DashboardHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border/60 bg-background/80 px-4 sm:px-6 backdrop-blur-md">
      {/* Brand & Status Badge */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Sentinel Logo"
            width={32}
            height={32}
            className="object-contain rounded-md"
            priority
          />
          <div>
            <h1 className="text-base font-bold tracking-tight text-foreground leading-none">
              Sentinel
            </h1>

          </div>
        </div>
      </div>

      {/* Actions & Theme Toggler */}
      <div className="flex items-center gap-2 sm:gap-3">
        <ThemeToggle />
      </div>
    </header>
  );
}
