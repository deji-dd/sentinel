"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Minimal theme toggle that cycles between light and dark.
 * Renders nothing during SSR to avoid hydration mismatch.
 */
export function ThemeToggle() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const isDark = resolvedTheme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-none h-10 w-full flex items-center gap-3 px-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
    >
      {isDark ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
      <span className="font-mono text-[10px] tracking-[0.2em] group-data-[collapsible=icon]:hidden">
        {isDark ? "LIGHT_MODE" : "DARK_MODE"}
      </span>
    </button>
  );
}
