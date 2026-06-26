"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Home,
  Dumbbell,
  Sun,
  Moon,
  FlaskConical,
  Palette,
  Bell,
  BellOff,
  Fingerprint,
  Settings,
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
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { usePush } from "@/hooks/use-push";

const navItems = [
  { name: "Overview", href: "/", icon: Home },
  { name: "Gym", href: "/gym", icon: Dumbbell },
  { name: "Crimes", href: "/crimes", icon: Fingerprint },
  { name: "Beta", href: "/beta", icon: FlaskConical },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { subscribed, toggle: togglePush, loading: pushLoading } = usePush();

  // Only render theme-dependent UI after mount to prevent SSR hydration mismatch
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return (
    <Sidebar className="z-30" collapsible="icon">
      <SidebarHeader className="p-0 group-data-[collapsible=icon]:hidden border-b border-zinc-200 dark:border-zinc-900 shrink-0 flex flex-col">
        <div className="w-full h-[env(safe-area-inset-top)] shrink-0" />

        <div className="flex h-16 items-center justify-center px-4 w-full">
          <Link href="/" className="flex items-center gap-3 overflow-hidden select-none w-full">
            <Avatar className="size-10 rounded-full after:rounded-full shrink-0">
              <AvatarImage src="/logo.png" className="object-cover rounded-full" alt="Sentinel Logo" />
              <AvatarFallback className="rounded-full">S</AvatarFallback>
            </Avatar>
          </Link>
        </div>
      </SidebarHeader>

      {/* Navigation */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.name}
                      className={
                        isActive
                          ? "text-amber-600 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-500/15"
                          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/60"
                      }
                      render={<Link href={item.href} />}
                    >
                      <Icon className="h-5 w-5" />
                      <span>{item.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-zinc-200 dark:border-zinc-900 p-3 space-y-1">
        <SidebarMenu>
          {/* Push Notifications Toggle */}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={togglePush}
              disabled={pushLoading}
              tooltip={subscribed ? "Disable Alerts" : "Enable Alerts"}
              className={
                subscribed
                  ? "text-amber-600 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-500/15"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/60"
              }
            >
              {subscribed ? (
                <>
                  <Bell className="h-5 w-5 shrink-0" />
                  <span className="group-data-[collapsible=icon]:hidden">Alerts On</span>
                </>
              ) : (
                <>
                  <BellOff className="h-5 w-5 shrink-0" />
                  <span className="group-data-[collapsible=icon]:hidden">Alerts Off</span>
                </>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Theme Switcher */}
          <SidebarMenuItem>
            {mounted ? (
              <SidebarMenuButton
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                tooltip={theme === "dark" ? "Light Mode" : "Dark Mode"}
                className="text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/60"
              >
                {theme === "dark" ? (
                  <>
                    <Sun className="h-5 w-5 text-amber-500 shrink-0" />
                    <span className="group-data-[collapsible=icon]:hidden">Light Mode</span>
                  </>
                ) : (
                  <>
                    <Moon className="h-5 w-5 text-indigo-500 shrink-0" />
                    <span className="group-data-[collapsible=icon]:hidden">Dark Mode</span>
                  </>
                )}
              </SidebarMenuButton>
            ) : (
              // Stable placeholder prevents SSR mismatch
              <SidebarMenuButton
                tooltip="Theme"
                className="text-zinc-400 opacity-50 pointer-events-none"
              >
                <Palette className="h-5 w-5 shrink-0" />
                <span className="group-data-[collapsible=icon]:hidden">Theme</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
