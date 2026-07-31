"use client";

import React, { useState } from "react";
import { X, ShieldCheck, FileText, Lock } from "lucide-react";

type LegalType = "tos" | "privacy";

interface LegalModalProps {
  type: LegalType;
  children: React.ReactNode;
}

export function LegalModal({ type, children }: LegalModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  const isTos = type === "tos";
  const title = isTos ? "Terms of Service" : "Privacy Policy";
  const subtitle = isTos
    ? "Please read our Terms of Service carefully before using Sentinel."
    : "How Sentinel collects, encrypts, and protects your data.";

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="underline underline-offset-4 hover:text-blue-400 cursor-pointer outline-none transition-colors"
      >
        {children}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200 text-left">
          <div className="relative w-full max-w-2xl bg-[#121827] border border-[#1f293d] rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-gray-200 text-left">
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-[#1f293d] bg-[#0d121f] text-left">
              <div className="flex items-center gap-3 text-left">
                <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  {isTos ? <FileText className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-bold text-white tracking-tight text-left">{title}</h3>
                  <p className="text-xs text-gray-400 text-left">{subtitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-sm text-gray-300 leading-relaxed text-left">
              {isTos ? (
                <>
                  <section className="space-y-2">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      1. Acceptance of Terms
                    </h4>
                    <p>
                      By accessing and using the Sentinel Discord bot, API gateway, or web dashboard, you agree to be bound by these Terms of Service. If you disagree with any part of these terms, you may not access or use the service.
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      2. Description of Service
                    </h4>
                    <p>
                      Sentinel provides Discord server automation, Torn City member verification, reaction role management, and territory assault monitoring. We reserve the right to modify, suspend, or discontinue any feature at any time without prior notice.
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      3. User Conduct & Compliance
                    </h4>
                    <p>
                      You agree to comply with Discord Terms of Service and Torn City API Fair Play guidelines. You may not attempt to exploit, reverse engineer, or flood Sentinel APIs or Discord bot endpoints. Operators reserve the right to revoke access to any server or user violating these guidelines.
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      4. Limitation of Liability
                    </h4>
                    <p>
                      Sentinel is provided on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis. In no event shall Sentinel developers or operators be liable for any indirect, incidental, or consequential damages resulting from your use of the service.
                    </p>
                  </section>
                </>
              ) : (
                <>
                  <section className="space-y-2">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      1. Information We Collect
                    </h4>
                    <p>
                      When authenticating or configuring Sentinel, we collect your Discord User ID, username, and server permission scopes. When using Torn verification services, we store linked Torn Player IDs and encrypted API keys.
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      2. Security & AES-256 Encryption
                    </h4>
                    <p>
                      All Torn API keys stored by Sentinel are encrypted using AES-256-GCM and pepper-hashed. Your credentials are never stored in plaintext and are used exclusively to process authorized verification and faction sync tasks. We never sell or share user data with third parties.
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      3. Data Retention & Maintenance
                    </h4>
                    <p>
                      Verification activity logs are automatically pruned on routine maintenance schedules. Server configuration data is retained as long as the Sentinel bot remains active in your Discord guild.
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      4. Third-Party Integrations
                    </h4>
                    <p>
                      Sentinel integrates directly with Discord OAuth2 and Torn City public APIs. Please review Discord and Torn City privacy statements regarding platform data governance.
                    </p>
                  </section>
                </>
              )}

              <div className="pt-4 border-t border-[#1f293d] text-xs text-gray-500 flex items-center justify-between">
                <span>Last updated: July 2026</span>

              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
