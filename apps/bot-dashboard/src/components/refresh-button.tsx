"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { refreshGuilds } from "@/actions/discord";

export function RefreshButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button 
      variant="outline" 
      size="icon" 
      disabled={isPending}
      onClick={() => startTransition(() => refreshGuilds())}
      title="Refresh servers"
    >
      <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
      <span className="sr-only">Refresh</span>
    </Button>
  );
}
