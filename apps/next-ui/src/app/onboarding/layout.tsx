import { ReactNode } from "react";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Initialize Sentinel",
};

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-dvh w-screen overflow-hidden bg-black text-white flex items-center justify-center p-4 selection:bg-white/20 selection:text-white">
      {children}
    </div>
  );
}
