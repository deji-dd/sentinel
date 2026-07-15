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
    <Sidebar variant="sidebar" className="z-30 border-r border-neutral-900 bg-black text-white" collapsible="icon">
      <SidebarHeader className="p-0 border-b border-neutral-900 shrink-0 flex flex-col bg-black h-12 justify-center">
        <Link href="/" prefetch={false} className="flex items-center gap-3 overflow-hidden select-none px-4 group-data-[collapsible=icon]:justify-center">
          <div className="size-8 bg-black shrink-0 relative flex items-center justify-center overflow-hidden rounded-sm">
            <Image src="/logo.png" alt="Sentinel Logo" fill sizes="32px" className="object-contain" unoptimized />
          </div>
          <span className="font-mono tracking-[0.3em] text-[10px] font-bold group-data-[collapsible=icon]:hidden">SENTINEL</span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="bg-black">
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden text-[9px] tracking-[0.4em] font-mono text-neutral-600 mt-4 mb-2">MODULES</SidebarGroupLabel>
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
                            ? "bg-white text-black hover:bg-neutral-200 hover:text-black"
                            : "text-neutral-500 hover:bg-neutral-900 hover:text-white"
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

      <SidebarFooter className="border-t border-neutral-900 bg-black p-2 space-y-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={togglePush}
              disabled={pushLoading}
              tooltip={subscribed ? "DISABLE_ALERTS" : "ENABLE_ALERTS"}
              className={cn(
                "rounded-none h-10 transition-colors",
                subscribed
                  ? "text-white hover:bg-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-900 hover:text-white"
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
      </SidebarFooter>
    </Sidebar>
  );
}
