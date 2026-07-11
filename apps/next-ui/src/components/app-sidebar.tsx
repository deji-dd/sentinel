"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { cn } from "@/lib/utils";
import {
  Home,
  Sun,
  Moon,
  Palette,
  Bell,
  BellOff,
  Settings,
  Landmark,
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
  { name: "Wealth Matrix", href: "/wealth", icon: Landmark },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { subscribed, toggle: togglePush, loading: pushLoading } = usePush();

  useGSAP(
    () => {
      gsap.fromTo(
        ".nav-item",
        { opacity: 0, x: -15, rotateX: -10 },
        {
          opacity: 1,
          x: 0,
          rotateX: 0,
          stagger: 0.05,
          duration: 0.6,
          ease: "back.out(1.5)",
          clearProps: "transform",
        }
      );
    },
    { dependencies: [] }
  );

  // Only render theme-dependent UI after mount to prevent SSR hydration mismatch
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return (
    <Sidebar variant="floating" className="z-30" collapsible="icon">
      <SidebarHeader className="p-0 group-data-[collapsible=icon]:hidden border-b border-zinc-200/50 dark:border-white/5 shrink-0 flex flex-col bg-transparent">
        <div className="w-full h-[env(safe-area-inset-top)] shrink-0" />

        <div className="flex h-16 items-center justify-center px-4 w-full">
          <Link href="/" prefetch={false} className="flex items-center gap-3 overflow-hidden select-none w-full">
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
                  <SidebarMenuItem key={item.href} className="nav-item [perspective:1000px]">
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.name}
                      className={cn(
                        "transition-all duration-300 ease-out hover:-translate-y-[1px] hover:shadow-lg",
                        isActive
                          ? "text-amber-600 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 shadow-[0_8px_16px_rgba(245,158,11,0.1)]"
                          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-500/10 dark:hover:bg-zinc-800/50 hover:border-zinc-200 dark:hover:border-zinc-700/50 border border-transparent backdrop-blur-sm"
                      )}
                      render={<Link href={item.href} prefetch={false} />}
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
      <SidebarFooter className="border-t border-zinc-200/50 dark:border-white/5 space-y-1 bg-transparent">
        <SidebarMenu>
          {/* Push Notifications Toggle */}
          <SidebarMenuItem className="nav-item">
            <SidebarMenuButton
              onClick={togglePush}
              disabled={pushLoading}
              tooltip={subscribed ? "Disable Alerts" : "Enable Alerts"}
              className={cn(
                "transition-all duration-300 ease-out hover:-translate-y-[1px] hover:shadow-lg",
                subscribed
                  ? "text-amber-600 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 shadow-[0_8px_16px_rgba(245,158,11,0.1)]"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-500/10 dark:hover:bg-zinc-800/50 hover:border-zinc-200 dark:hover:border-zinc-700/50 border border-transparent backdrop-blur-sm"
              )}
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
          <SidebarMenuItem className="nav-item">
            {mounted ? (
              <SidebarMenuButton
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                tooltip={theme === "dark" ? "Light Mode" : "Dark Mode"}
                className="transition-all duration-300 ease-out hover:-translate-y-[1px] hover:shadow-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-500/10 dark:hover:bg-zinc-800/50 hover:border-zinc-200 dark:hover:border-zinc-700/50 border border-transparent backdrop-blur-sm"
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
