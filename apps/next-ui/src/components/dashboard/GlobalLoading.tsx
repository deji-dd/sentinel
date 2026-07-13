"use client";

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

export default function GlobalLoading() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  useGSAP(() => {
    // 3D Isometric hover effect
    gsap.to('.loader-card', {
      y: -10,
      duration: 2,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut'
    });
    
    // Rotating rings
    gsap.to('.ring-outer', {
      rotationX: 360,
      rotationY: 180,
      rotationZ: 360,
      duration: 8,
      repeat: -1,
      ease: 'linear'
    });
    
    gsap.to('.ring-inner', {
      rotationX: -360,
      rotationY: 360,
      rotationZ: -180,
      duration: 6,
      repeat: -1,
      ease: 'linear'
    });
  }, { scope: containerRef });

  return (
    <div ref={containerRef} className="flex items-center justify-center min-h-[60vh] w-full perspective-[1000px] animate-in fade-in duration-500">
      <div className="loader-card relative flex flex-col items-center justify-center p-12 bg-white/5 dark:bg-white/[0.02] backdrop-blur-[20px] border border-zinc-200/50 dark:border-white/10 rounded-[2rem] shadow-[0_30px_60px_rgba(0,0,0,0.12)] dark:shadow-[0_30px_60px_rgba(0,0,0,0.4)]" style={{ transformStyle: 'preserve-3d' }}>
        
        {/* Antigravity 3D Rings */}
        <div className="relative w-24 h-24 mb-8" style={{ transformStyle: 'preserve-3d' }}>
          {/* Glowing core */}
          <div className="absolute inset-0 m-auto w-6 h-6 bg-indigo-500 rounded-full shadow-[0_0_30px_10px_rgba(99,102,241,0.5)] animate-pulse"></div>
          
          {/* Outer Ring */}
          <div className="ring-outer absolute inset-0 border-[2px] border-indigo-500/30 dark:border-indigo-400/30 rounded-full" style={{ transformStyle: 'preserve-3d' }}>
             <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-indigo-500 dark:bg-indigo-400 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.8)]"></div>
          </div>
          
          {/* Inner Ring */}
          <div className="ring-inner absolute inset-2 border-[2px] border-emerald-500/30 dark:border-emerald-400/30 rounded-full" style={{ transformStyle: 'preserve-3d' }}>
             <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-emerald-500 dark:bg-emerald-400 rounded-full shadow-[0_0_10px_rgba(52,211,153,0.8)]"></div>
          </div>
        </div>
        
        <p className="text-xs font-black tracking-[0.3em] text-zinc-600 dark:text-zinc-400 uppercase opacity-70">
          Syncing
        </p>
      </div>
    </div>
  );
}
