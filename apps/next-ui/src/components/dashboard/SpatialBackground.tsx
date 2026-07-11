"use client";

import React, { useEffect, useRef } from "react";
import gsap from "gsap";
import { cn } from "@/lib/utils";

interface SpatialBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function SpatialBackground({ children, className, ...props }: SpatialBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const orb1Ref = useRef<HTMLDivElement>(null);
  const orb2Ref = useRef<HTMLDivElement>(null);
  const orb3Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Ambient floating animations for the orbs
    const orbs = [orb1Ref.current, orb2Ref.current, orb3Ref.current];
    
    orbs.forEach((orb, i) => {
      if (!orb) return;
      
      gsap.to(orb, {
        x: `random(-100, 100)`,
        y: `random(-100, 100)`,
        rotation: `random(-90, 90)`,
        duration: `random(10, 20)`,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        delay: i * 2,
      });
    });

    // Parallax effect on mouse move
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      
      const { clientX, clientY } = e;
      const xPos = (clientX / window.innerWidth - 0.5) * 40;
      const yPos = (clientY / window.innerHeight - 0.5) * 40;

      gsap.to(orb1Ref.current, { x: xPos * 1, y: yPos * 1, duration: 2, ease: "power2.out" });
      gsap.to(orb2Ref.current, { x: xPos * -1.5, y: yPos * -1.5, duration: 2.5, ease: "power2.out" });
      gsap.to(orb3Ref.current, { x: xPos * 0.5, y: yPos * -0.5, duration: 3, ease: "power2.out" });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div 
      ref={containerRef} 
      className={cn("fixed inset-0 h-screen w-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950", className)}
      {...props}
    >
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 z-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)]" />

      {/* Ambient Orbs */}
      <div 
        ref={orb1Ref}
        className="absolute top-[20%] left-[20%] w-96 h-96 bg-emerald-500/20 rounded-full blur-[100px] pointer-events-none mix-blend-screen dark:mix-blend-lighten"
      />
      <div 
        ref={orb2Ref}
        className="absolute bottom-[20%] right-[20%] w-[500px] h-[500px] bg-indigo-500/20 rounded-full blur-[120px] pointer-events-none mix-blend-screen dark:mix-blend-lighten"
      />
      <div 
        ref={orb3Ref}
        className="absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-violet-500/10 rounded-full blur-[150px] pointer-events-none mix-blend-screen dark:mix-blend-lighten"
      />

      {/* Foreground Content */}
      <div className="relative z-10 w-full h-full flex flex-col">
        {children}
      </div>
    </div>
  );
}
