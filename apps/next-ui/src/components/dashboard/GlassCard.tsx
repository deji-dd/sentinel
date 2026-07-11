"use client";

import React, { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { cn } from "@/lib/utils";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  tiltIntensity?: number;
}

export function GlassCard({ children, className, tiltIntensity = 15, ...props }: GlassCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      // Calculate cursor position relative to the center of the card
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;

      // Calculate tilt based on intensity
      const xPct = x / (rect.width / 2);
      const yPct = y / (rect.height / 2);

      gsap.to(card, {
        duration: 0.5,
        rotateX: -yPct * tiltIntensity,
        rotateY: xPct * tiltIntensity,
        ease: "power2.out",
        transformPerspective: 1000,
        transformOrigin: "center center",
      });
    };

    const handleMouseLeave = () => {
      gsap.to(card, {
        duration: 0.8,
        rotateX: 0,
        rotateY: 0,
        ease: "elastic.out(1, 0.3)",
      });
    };

    card.addEventListener("mousemove", handleMouseMove);
    card.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      card.removeEventListener("mousemove", handleMouseMove);
      card.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, { scope: cardRef, dependencies: [] });

  return (
    <div
      ref={cardRef}
      className={cn(
        "relative rounded-2xl overflow-hidden border border-zinc-200/50 dark:border-white/5",
        "bg-white/40 dark:bg-zinc-950/40",
        "backdrop-blur-xl shadow-2xl",
        "transition-shadow duration-300",
        className
      )}
      {...props}
    >
      {/* Subtle top glare effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none rounded-2xl mix-blend-overlay" />
      <div className="relative z-10 p-6">
        {children}
      </div>
    </div>
  );
}
