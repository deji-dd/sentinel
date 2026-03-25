import 'ldrs/trefoil'
import { cn } from "@/lib/utils"

interface LoadingScreenProps {
  message?: string;
  subMessage?: string;
  fullScreen?: boolean;
}

export function LoadingScreen({
  subMessage = "Initializing Sentinel",
  fullScreen = true
}: LoadingScreenProps) {
  return (
    <div className={cn(
      "w-full flex flex-col items-center justify-center transition-all animate-in fade-in duration-500",
      fullScreen ? "h-screen bg-background" : "p-24 bg-transparent"
    )}>
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <div className={cn(
            "relative flex items-center justify-center",
          )}>
            {/* @ts-ignore - Custom element defined by ldrs/trefoil */}
            <l-trefoil
              size={fullScreen ? "40" : "30"}
              stroke="4"
              stroke-length="0.15"
              bg-opacity="0.1"
              speed="1.4"
              color="var(--foreground)"
            >
              {/* @ts-ignore - Custom element */}
            </l-trefoil>
          </div>
        </div>
        <p className={cn(
          "text-muted-foreground font-medium tracking-[0.2em] text-xs uppercase opacity-50 animate-pulse",
          fullScreen ? "text-[10px]" : "text-[8px]"
        )}>
          {subMessage}
        </p>
      </div>
    </div>
  )
}

export function TacticalLoader({
  size = 18,
  color = "#7c3aed",
  stroke = 4,
  className
}: {
  size?: number | string,
  color?: string,
  stroke?: number | string,
  className?: string
}) {
  return (
    <div className={cn("inline-flex items-center justify-center", className)}>
      {/* @ts-ignore - Custom element */}
      <l-trefoil
        size={String(size)}
        stroke={String(stroke)}
        stroke-length="0.15"
        bg-opacity="0.1"
        speed="1.4"
        color={color}
      >
        {/* @ts-ignore - Custom element */}
      </l-trefoil>
    </div>
  )
}
