"use client";

import React from 'react';
import { Loader2 } from 'lucide-react';

export default function GlobalLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] w-full animate-in fade-in duration-500">
      <div className="flex flex-col items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500 dark:text-zinc-400 mb-4" />
        <p className="text-xs font-medium tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">
          Syncing
        </p>
      </div>
    </div>
  );
}
