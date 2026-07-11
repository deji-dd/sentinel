"use client";

import React, { useState } from "react";
import { 
  Sheet, 
  SheetContent, 
  SheetDescription, 
  SheetHeader, 
  SheetTitle, 
  SheetTrigger 
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionItem } from "@/hooks/use-wealth-ledger";
import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";

export function ActionQueueSheet({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const handleResolve = async (id: string, e: React.FormEvent) => {
    e.preventDefault();
    setResolvingId(id);
    
    // Simulate API call to resolve action
    setTimeout(() => {
      setResolvingId(null);
      // Logic to refetch or clear item would go here
    }, 1000);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={
        <Button variant="outline" className="relative bg-zinc-100/80 dark:bg-black/20 border-zinc-200 dark:border-white/10 hover:bg-zinc-200/80 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300">
          <AlertCircle className="w-4 h-4 mr-2 text-amber-600 dark:text-amber-500" />
          Pending Reviews
          {items.length > 0 && (
            <span className="absolute -top-2 -right-2 w-5 h-5 bg-amber-500 text-white dark:text-black text-[10px] font-bold rounded-full flex items-center justify-center">
              {items.length}
            </span>
          )}
        </Button>
      } />
      
      <SheetContent className="bg-white/95 dark:bg-zinc-950/90 backdrop-blur-2xl border-l border-zinc-200 dark:border-white/10 w-[400px] sm:w-[540px]">
        <SheetHeader className="mb-8">
          <SheetTitle className="text-xl text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <AlertCircle className="text-amber-600 dark:text-amber-500" />
            Action Queue
          </SheetTitle>
          <SheetDescription className="text-zinc-500 dark:text-zinc-400">
            The parser encountered events with $0 cost basis (e.g., Barter Trades or Unique Items). Please provide a manual cash value to unblock ledger math.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <CheckCircle2 className="w-12 h-12 text-emerald-500/50 mb-4" />
              <p>All clear! No pending actions.</p>
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="p-4 rounded-xl border border-zinc-200 dark:border-white/5 bg-zinc-50/80 dark:bg-white/5 backdrop-blur-md relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1 h-full bg-amber-500/50" />
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
                    {item.type}
                  </span>
                  <span className="text-xs text-zinc-500 font-mono">
                    {new Date(item.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">{item.description}</p>
                
                <form onSubmit={(e) => handleResolve(item.id, e)} className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">$</span>
                    <Input 
                      type="number" 
                      placeholder="0.00" 
                      required
                      className="pl-8 bg-white/80 dark:bg-black/40 border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-zinc-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    disabled={resolvingId === item.id}
                    className="bg-indigo-500 hover:bg-indigo-600 text-white"
                  >
                    {resolvingId === item.id ? "Saving..." : <><ArrowRight className="w-4 h-4 mr-2" /> Resolve</>}
                  </Button>
                </form>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
