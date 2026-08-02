import React from "react";
import Image from "next/image";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { LegalModal } from "@/components/legal-modal";
import { DiscordLoginButton } from "@/components/action-buttons";
import { ShieldCheck } from "lucide-react";

export default async function LoginPage() {
  const session = await auth();

  if (session?.user) {
    redirect("/");
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#070a11] text-slate-100 font-sans">
      {/* Left Panel - Cyber Branding & Feature Showcase */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 lg:p-16 bg-gradient-to-br from-[#0b1220] via-[#070a11] to-[#090e1a] border-r border-slate-800/80 overflow-hidden">
        {/* Glow backdrop shapes */}
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-blue-600/10 blur-[120px] pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full bg-purple-600/10 blur-[120px] pointer-events-none" />

        {/* Top Branding */}
        <div className="relative z-10 flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Sentinel Logo"
            width={36}
            height={36}
            className="object-contain rounded-full"
          />
          <div>
            <span className="text-lg font-extrabold tracking-tight text-white block">
              Sentinel
            </span>

          </div>
        </div>

        {/* Center Headline & Features */}
        <div className="relative z-10 max-w-lg space-y-8 my-auto py-8">
          <div className="space-y-3">
            <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Please
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed">
              try not to break it.            </p>
          </div>
        </div>

        {/* Footer Badge */}
        <div className="relative z-10 flex items-center justify-between text-xs text-slate-500 pt-6 border-t border-slate-800/60">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono">Sentinel v2</span>
          </div>
          <span className="font-mono text-[11px]">Made by Blasted</span>
        </div>
      </div>

      {/* Right Panel - Auth Action */}
      <div className="flex flex-col justify-center items-center p-8 sm:p-12 lg:p-16 relative">
        <div className="w-full max-w-md flex flex-col gap-8">
          {/* Mobile Header Branding */}
          <div className="flex lg:hidden items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center p-1.5 shadow-md">
              <Image
                src="/logo.png"
                alt="Sentinel Logo"
                width={36}
                height={36}
                className="object-contain"
              />
            </div>
            <div>
              <span className="text-lg font-extrabold tracking-tight text-white block">
                Sentinel
              </span>
              <span className="text-[10px] font-mono text-slate-400 block -mt-1">
                Command Dashboard
              </span>
            </div>
          </div>

          <div className="space-y-2 text-left">
            <h2 className="text-3xl font-extrabold tracking-tight text-white">
              Welcome Back
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Sign in with Discord to access your authorized server configuration panels.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-[#0c111d] border border-slate-800/80 shadow-2xl space-y-6">
            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
              <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0" />
              <span>OAuth2 login requests read-only guild list permissions to identify shared servers.</span>
            </div>

            <DiscordLoginButton />
          </div>

          <div className="text-xs text-slate-500 text-center leading-relaxed">
            By signing in, you agree to the Sentinel{" "}
            <LegalModal type="tos">Terms of Service</LegalModal> and{" "}
            <LegalModal type="privacy">Privacy Policy</LegalModal>.
          </div>
        </div>
      </div>
    </div>
  );
}
