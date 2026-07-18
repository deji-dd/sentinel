"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Home,
  Bell,
  BellOff,
  Target,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import { usePush } from "@/hooks/use-push";
import { useSettings } from "@/components/settings-provider";
import { ThemeToggle } from "@/components/theme-toggle";

const navItems = [
  { name: "OVERVIEW", href: "/", icon: Home },
  { name: "CRIME_LEDGER", href: "/crimes", icon: Target },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { subscribed, toggle: togglePush, loading: pushLoading } = usePush();

  const { settings } = useSettings();
  const logManagerEnabled = settings.log_manager_enabled;

  return (
    <Sidebar variant="sidebar" className="z-30 border-r border-sidebar-border bg-sidebar text-sidebar-foreground" collapsible="icon">
      <SidebarHeader className="p-0 border-b border-sidebar-border shrink-0 flex flex-col bg-sidebar h-12 justify-center">
        <Link href="/" prefetch={false} className="flex items-center gap-3 overflow-hidden select-none px-4 group-data-[collapsible=icon]:justify-center">
          <div className="size-8 bg-sidebar shrink-0 relative flex items-center justify-center overflow-hidden rounded-sm">
            <Image src="/logo.png" alt="Sentinel Logo" fill sizes="32px" className="object-contain" />
          </div>
          <span className="font-mono tracking-[0.3em] text-[10px] font-bold group-data-[collapsible=icon]:hidden">SENTINEL</span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="bg-sidebar">
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden text-[9px] tracking-[0.4em] font-mono text-muted-foreground mt-4 mb-2">MODULES</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                const isOverview = item.href === "/";
                const isDisabled = !isOverview && !logManagerEnabled;

                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.name}
                      disabled={isDisabled}
                      className={cn(
                        "rounded-none h-10 transition-colors",
                        isDisabled
                          ? "opacity-50 cursor-not-allowed pointer-events-none text-neutral-600"
                          : isActive
                            ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      )}
                      render={isDisabled ? <div /> : <Link href={item.href} prefetch={false} />}
                    >
                      <Icon className="size-4" />
                      <span className="font-mono text-[10px] tracking-[0.2em]">{item.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border bg-sidebar p-2 space-y-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={togglePush}
              disabled={pushLoading}
              tooltip={subscribed ? "DISABLE_ALERTS" : "ENABLE_ALERTS"}
              className={cn(
                "rounded-none h-10 transition-colors",
                subscribed
                  ? "text-sidebar-foreground hover:bg-sidebar-accent"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              {subscribed ? (
                <>
                  <Bell className="size-4 shrink-0" />
                  <span className="font-mono text-[10px] tracking-[0.2em] group-data-[collapsible=icon]:hidden">ALERTS_ON</span>
                </>
              ) : (
                <>
                  <BellOff className="size-4 shrink-0" />
                  <span className="font-mono text-[10px] tracking-[0.2em] group-data-[collapsible=icon]:hidden">ALERTS_OFF</span>
                </>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>

        </SidebarMenu>
        <ThemeToggle />
      </SidebarFooter>
    </Sidebar>
  );
}
