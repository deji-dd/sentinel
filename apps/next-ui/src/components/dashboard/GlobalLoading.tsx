"use client";

import React, { useState, useEffect } from 'react';

export default function GlobalLoading() {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] w-full animate-in fade-in duration-500">
      <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground flex items-center gap-2 uppercase">
        <span>SYNCHRONIZING_DATA</span>
        <span className="w-4 text-left">{dots}</span>
      </div>
      <div className="mt-6 flex gap-1.5">
        <div className="w-2 h-4 bg-foreground animate-pulse" style={{ animationDuration: '1s' }} />
        <div className="w-2 h-4 bg-foreground/50 animate-pulse" style={{ animationDuration: '1s', animationDelay: '200ms' }} />
        <div className="w-2 h-4 bg-foreground/20 animate-pulse" style={{ animationDuration: '1s', animationDelay: '400ms' }} />
      </div>
    </div>
  );
}

