"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isModuleEnabled as isModuleEnabledUtil } from "@sentinel/utils";
import {
  Settings,
  Sliders,
  UserCheck,
  MapPin,
  Smile,
  Lock,
  ChevronRight,
  Activity,
} from "lucide-react";

interface GuildSidebarProps {
  guildId: string;
  enabledModules: string[];
  isBotOwner: boolean;
  onNavigate?: () => void;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  alwaysEnabled?: boolean;
  exact?: boolean;
  visible: boolean;
  moduleKey?: string;
  accent?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export function GuildSidebar({
  guildId,
  enabledModules,
  isBotOwner,
  onNavigate,
}: GuildSidebarProps) {
  const pathname = usePathname();

  const isModuleEnabled = (moduleKey: string) =>
    isModuleEnabledUtil(enabledModules, moduleKey);

  const sections: NavSection[] = [
    {
      title: "Core Configuration",
      items: [
        {
          label: "General Settings",
          href: `/guilds/${guildId}`,
          icon: Settings,
          alwaysEnabled: true,
          exact: true,
          visible: true,
        },
      ],
    },
    {
      title: "Guild Modules",
      items: [
        {
          label: "Verification",
          href: `/guilds/${guildId}/verification`,
          icon: UserCheck,
          moduleKey: "verification",
          visible: true,
          accent: "text-blue-400",
        },
        {
          label: "Territory",
          href: `/guilds/${guildId}/territory`,
          icon: MapPin,
          moduleKey: "territory",
          visible: true,
          accent: "text-purple-400",
        },
        {
          label: "Reaction Role",
          href: `/guilds/${guildId}/reaction-roles`,
          icon: Smile,
          moduleKey: "reaction_role",
          visible: true,
          accent: "text-amber-400",
        },
      ],
    },
    {
      title: "System Administration",
      items: [
        {
          label: "Module Manager",
          href: `/guilds/${guildId}/modules`,
          icon: Sliders,
          alwaysEnabled: true,
          visible: isBotOwner,
        },
      ],
    },
  ];

  return (
    <aside className="w-64 lg:w-72 bg-[#0c111d] border-r border-slate-800/80 p-4 flex flex-col justify-between shrink-0 h-full overflow-y-auto">
      <div className="space-y-6">
        {sections.map((sec, idx) => {
          const visibleItems = sec.items.filter((item) => item.visible);
          if (visibleItems.length === 0) return null;

          return (
            <div key={idx} className="space-y-2">
              <div className="px-3 pt-1">
                <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 font-bold">
                  {sec.title}
                </span>
              </div>

              <nav className="flex flex-col gap-1">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const enabled =
                    item.alwaysEnabled ||
                    (item.moduleKey && isModuleEnabled(item.moduleKey));
                  const isActive = item.exact
                    ? pathname === item.href
                    : pathname.startsWith(item.href);

                  if (!enabled) {
                    return (
                      <div
                        key={item.href}
                        className="flex items-center justify-between py-2.5 px-3 rounded-xl text-xs font-medium text-slate-600 cursor-not-allowed select-none bg-slate-900/40 border border-transparent"
                        title="Module disabled for this server"
                      >
                        <div className="flex items-center gap-3">
                          <Icon className="w-4 h-4 text-slate-600" />
                          <span>{item.label}</span>
                        </div>
                        <Lock className="w-3.5 h-3.5 text-slate-600" />
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      className={`group flex items-center justify-between py-2.5 px-3 rounded-xl text-xs font-medium transition-all duration-150 ${isActive
                        ? "bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-sm shadow-blue-500/10 font-semibold"
                        : "text-slate-300 hover:bg-slate-800/60 hover:text-white border border-transparent"
                        }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon
                          className={`w-4 h-4 transition-colors ${isActive
                            ? "text-blue-400"
                            : item.accent
                              ? `${item.accent} opacity-80 group-hover:opacity-100`
                              : "text-slate-400 group-hover:text-slate-200"
                            }`}
                        />
                        <span>{item.label}</span>
                      </div>
                      <ChevronRight
                        className={`w-3.5 h-3.5 transition-transform ${isActive
                          ? "text-blue-400 translate-x-0.5"
                          : "text-slate-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5"
                          }`}
                      />
                    </Link>
                  );
                })}
              </nav>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
