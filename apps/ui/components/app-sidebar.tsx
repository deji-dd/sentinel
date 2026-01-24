"use client";

import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
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
import { createClient } from "@/lib/supabase";
import { TABLE_NAMES } from "@/lib/constants";
import { Skeleton } from "@/components/ui/skeleton";

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
  const queryClient = useQueryClient();

  const {
    data: profile,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const userId = session?.user.id;
      if (!userId) return null;

      const { data, error } = await supabase
        .from(TABLE_NAMES.USER_DATA)
        .select("name, player_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw error;

      return data;
    },
    staleTime: 1000 * 60 * 5,
  });

  // Subscribe to real-time updates on user profile
  useEffect(() => {
    const supabase = createClient();

    const setupRealtimeSubscription = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user.id) return;

      const subscription = supabase
        .channel("user-profile-changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: TABLE_NAMES.USERS,
            filter: `user_id=eq.${session.user.id}`,
          },
          () => {
            // Invalidate the query to refetch fresh data
            queryClient.invalidateQueries({ queryKey: ["user-profile"] });
          },
        )
        .subscribe();

      return () => {
        subscription.unsubscribe();
      };
    };

    const cleanup = setupRealtimeSubscription();

    return () => {
      cleanup.then((unsub) => unsub?.());
    };
  }, [queryClient]);

  const displayName = isError
    ? "Unable to load profile"
    : (profile?.name ?? "Initializing...");

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
              {state === "expanded" && (
                <div className="px-2 py-1 space-y-1.5">
                  {isPending ? (
                    <>
                      <Skeleton className="h-4 w-24 bg-white/10" />
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-white">
                        {displayName}
                      </p>
                    </>
                  )}
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
