"use client";

import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Dumbbell,
  Banknote,
  Users,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { logout } from "@/app/actions/logout";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const navigationItems = [
  {
    title: "Overview",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Gym Coach",
    href: "/dashboard/gym",
    icon: Dumbbell,
  },
  {
    title: "Finance",
    href: "/dashboard/finance",
    icon: Banknote,
  },
  {
    title: "Faction",
    href: "/dashboard/faction",
    icon: Users,
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { state } = useSidebar();

  const handleLogout = async () => {
    toast.promise(logout(), {
      loading: "Logging out...",
      success: "Logged out successfully",
      error: "Failed to logout",
    });
  };

  return (
    <Sidebar
      variant="inset"
      className="bg-zinc-950! text-white! border-r border-white/10"
    >
      <SidebarContent className="bg-zinc-950!">
        <SidebarGroup>
          <SidebarGroupLabel className="text-zinc-400 text-xs uppercase tracking-wider px-3">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      className={`
                        transition-all duration-200
                        ${
                          isActive
                            ? "bg-blue-500/10 text-blue-400 border-l-2 border-blue-500"
                            : "text-zinc-400 hover:text-white hover:bg-white/5"
                        }
                      `}
                    >
                      <Link href={item.href}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-white/10 bg-zinc-950 p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex flex-col gap-2">
              {/* User info - will be populated later */}
              {state === "expanded" && (
                <div className="px-2 py-1">
                  <p className="text-sm font-medium text-white">Player Name</p>
                  <p className="text-xs text-zinc-500">Torn City</p>
                </div>
              )}

              {/* Logout button */}
              <SidebarMenuButton
                onClick={handleLogout}
                tooltip="Logout"
                className="text-red-400 cursor-pointer hover:text-red-300 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </SidebarMenuButton>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
