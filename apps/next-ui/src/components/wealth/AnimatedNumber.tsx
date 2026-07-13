"use client";

import React from "react";

export function AnimatedNumber({ 
  value, 
  prefix = "", 
  suffix = "", 
  className = "" 
}: { 
  value: number; 
  prefix?: string; 
  suffix?: string; 
  duration?: number;
  className?: string;
}) {
  const formatted = Math.abs(value) >= 1000 
    ? Math.floor(Math.abs(value)).toLocaleString() 
    : Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
  return (
    <span className={className}>
      {value < 0 ? '-' : ''}{prefix}{formatted}{suffix}
    </span>
  );
}
