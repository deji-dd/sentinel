"use client";

import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function DashboardHeader() {
  const pathname = usePathname();

  // Generate breadcrumbs from pathname
  const generateBreadcrumbs = () => {
    const segments = pathname.split("/").filter(Boolean);

    const breadcrumbs = segments.map((segment, index) => {
      const path = "/" + segments.slice(0, index + 1).join("/");
      const label = segment
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      return {
        label,
        path,
        isLast: index === segments.length - 1,
      };
    });

    return breadcrumbs;
  };

  const breadcrumbs = generateBreadcrumbs();

  return (
    <header className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950/50 backdrop-blur-md">
      <div className="flex items-center gap-4 px-4 py-3">
        <SidebarTrigger className="text-zinc-400 cursor-pointer " />

        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-sm">
          {breadcrumbs.map((crumb, index) => (
            <div key={crumb.path} className="flex items-center gap-2">
              {index > 0 && <ChevronRight className="w-4 h-4 text-zinc-600" />}
              {crumb.isLast ? (
                <span className="font-medium text-white">{crumb.label}</span>
              ) : (
                <Link
                  href={crumb.path}
                  className="text-zinc-400 hover:text-white transition-colors"
                >
                  {crumb.label}
                </Link>
              )}
            </div>
          ))}
        </nav>
      </div>
    </header>
  );
}
