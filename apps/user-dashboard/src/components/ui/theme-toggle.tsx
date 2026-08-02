"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function ThemeToggle({ className, compact }: { className?: string; compact?: boolean }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className={cn(
          compact
            ? "size-10 rounded-xl bg-muted/50 border border-border/50 shrink-0"
            : "inline-flex items-center gap-1 p-1 bg-muted/50 rounded-lg border border-border/50 w-[108px] h-9 shrink-0",
          className
        )}
      />
    );
  }

  if (compact) {
    const isDark = theme === "dark" || (theme === "system" && resolvedTheme === "dark");
    return (
      <button
        type="button"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        title={`Switch to ${isDark ? "Light" : "Dark"} Mode`}
        className={cn(
          "size-10 flex items-center justify-center rounded-xl bg-muted/50 border border-border/50 text-foreground hover:bg-muted/80 transition-colors shrink-0 mx-auto",
          className
        )}
      >
        {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </button>
    );
  }

  return (
    <div
      aria-label="Theme mode selection"
      className={cn(
        "inline-flex items-center gap-1 p-1 bg-muted/50 rounded-lg border border-border/50 backdrop-blur-sm shrink-0",
        className
      )}
    >
      <button
        type="button"
        onClick={() => setTheme("light")}
        title="Light Mode"
        className={cn(
          "relative flex items-center justify-center p-1.5 rounded-md text-xs font-medium border transition-colors duration-150",
          theme === "light"
            ? "bg-background text-foreground shadow-sm border-border/50"
            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-background/40"
        )}
      >
        <Sun className="size-3.5" />
        <span className="sr-only">Light</span>
      </button>

      <button
        type="button"
        onClick={() => setTheme("dark")}
        title="Dark Mode"
        className={cn(
          "relative flex items-center justify-center p-1.5 rounded-md text-xs font-medium border transition-colors duration-150",
          theme === "dark"
            ? "bg-background text-foreground shadow-sm border-border/50"
            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-background/40"
        )}
      >
        <Moon className="size-3.5" />
        <span className="sr-only">Dark</span>
      </button>

      <button
        type="button"
        onClick={() => setTheme("system")}
        title="System Mode"
        className={cn(
          "relative flex items-center justify-center p-1.5 rounded-md text-xs font-medium border transition-colors duration-150",
          theme === "system"
            ? "bg-background text-foreground shadow-sm border-border/50"
            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-background/40"
        )}
      >
        <Monitor className="size-3.5" />
        <span className="sr-only">System</span>
      </button>
    </div>
  );
}
