"use client";

import React, { useRef, useEffect } from "react";
import gsap from "gsap";

export function AnimatedNumber({ 
  value, 
  prefix = "", 
  suffix = "", 
  duration = 1.5,
  className = "" 
}: { 
  value: number; 
  prefix?: string; 
  suffix?: string; 
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  
  useEffect(() => {
    if (!ref.current) return;
    
    // Create an object to tween
    const target = { val: 0 };
    
    gsap.to(target, {
      val: value,
      duration: duration,
      ease: "power3.out",
      onUpdate: () => {
        if (ref.current) {
          // Format with commas and optional decimal for smaller numbers
          const formatted = Math.abs(target.val) >= 1000 
            ? Math.floor(target.val).toLocaleString() 
            : target.val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            
          ref.current.innerText = `${target.val < 0 ? '-' : ''}${prefix}${formatted}${suffix}`;
        }
      }
    });
  }, [value, prefix, suffix, duration]);

  return <span ref={ref} className={className}>{prefix}0{suffix}</span>;
}
