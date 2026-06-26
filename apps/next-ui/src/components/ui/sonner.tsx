"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4 text-emerald-500" />
        ),
        info: (
          <InfoIcon className="size-4 text-blue-400" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4 text-amber-500" />
        ),
        error: (
          <OctagonXIcon className="size-4 text-rose-500" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin text-amber-500" />
        ),
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-zinc-900/90 group-[.toaster]:backdrop-blur-md group-[.toaster]:text-zinc-100 group-[.toaster]:border-zinc-800 group-[.toaster]:shadow-2xl group-[.toaster]:rounded-2xl border font-sans p-4 flex gap-3 items-center",
          description: "group-[.toast]:text-zinc-400 text-xs",
          success: "group-[.toaster]:!border-emerald-500/30 group-[.toaster]:!bg-emerald-950/20",
          error: "group-[.toaster]:!border-rose-500/30 group-[.toaster]:!bg-rose-950/20",
          warning: "group-[.toaster]:!border-amber-500/30 group-[.toaster]:!bg-amber-950/20",
          info: "group-[.toaster]:!border-blue-500/30 group-[.toaster]:!bg-blue-950/20",
          actionButton:
            "group-[.toast]:bg-amber-500 group-[.toast]:text-zinc-950 font-bold",
          cancelButton:
            "group-[.toast]:bg-zinc-800 group-[.toast]:text-zinc-400",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

