"use client";

import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { authenticateTornUser } from "@/app/actions/authenticate";

export function LoginCard() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateApiKey = (key: string): boolean => {
    // Must be exactly 16 alphanumeric characters
    return /^[a-zA-Z0-9]{16}$/.test(key);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!validateApiKey(apiKey)) {
      toast.error("Invalid API Key", {
        description: "API Key must be exactly 16 alphanumeric characters.",
      });
      return;
    }

    setIsLoading(true);

    // Show loading toast and execute server action
    const promise = authenticateTornUser(apiKey);

    toast.promise(promise, {
      loading: "Verifying Torn City credentials...",
      success: () => {
        setIsLoading(false);
        setApiKey("");
        return "Access Granted, Sentinel";
      },
      error: (error) => {
        setIsLoading(false);
        // Don't show error if it's a redirect (NEXT_REDIRECT is handled automatically)
        if (error?.message?.includes("NEXT_REDIRECT")) {
          return null;
        }
        return error?.message || "Failed to verify API Key. Please try again.";
      },
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Only allow alphanumeric characters and limit to 16
    if (/^[a-zA-Z0-9]*$/.test(value) && value.length <= 16) {
      setApiKey(value);
    }
  };

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{
        duration: 0.6,
        type: "spring",
        stiffness: 100,
        damping: 15,
      }}
      className="relative w-full max-w-md"
    >
      {/* Glow Effect */}
      <div
        className="absolute inset-0 rounded-2xl opacity-0 blur-2xl transition-opacity duration-300"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.15) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* Main Card */}
      <div className="relative backdrop-blur-xl border border-white/10 rounded-2xl p-8 bg-zinc-950/70 shadow-2xl">
        {/* Background gradient effect */}
        <div className="absolute inset-0 rounded-2xl bg-linear-to-br from-white/5 to-transparent pointer-events-none" />

        {/* Content */}
        <div className="relative z-10 space-y-8">
          {/* Header */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-white tracking-widest">
              SENTINEL
            </h1>
            <p className="text-sm text-zinc-400 tracking-wide">
              Secure Access Portal
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* API Key Input */}
            <div className="space-y-2">
              <label
                htmlFor="api-key"
                className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider"
              >
                Torn API Key
              </label>

              <div
                className={`relative transition-all duration-300 ${
                  isFocused ? "ring-2 ring-blue-500/50" : ""
                } rounded-lg`}
              >
                <input
                  ref={inputRef}
                  id="api-key"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={handleInputChange}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  placeholder="XXXXXXXXXXXXXXXX"
                  maxLength={16}
                  disabled={isLoading}
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-white/10 rounded-lg text-white text-lg font-mono tracking-widest placeholder-zinc-600 transition-all duration-300 focus:outline-none focus:border-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                />

                {/* Toggle Show/Hide Button */}
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  disabled={isLoading || apiKey.length === 0}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={showKey ? "Hide API Key" : "Show API Key"}
                >
                  {showKey ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>

              {/* Character Count */}
              <div className="text-xs text-zinc-500 text-right">
                {apiKey.length}/16 characters
              </div>
            </div>

            {/* Submit Button with Shimmer Effect */}
            <motion.button
              type="submit"
              disabled={isLoading}
              whileTap={{ scale: 0.98 }}
              className="relative cursor-pointer w-full px-4 py-3 bg-linear-to-r from-blue-600 to-blue-500 text-white font-semibold uppercase tracking-wider rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
            >
              {/* Shimmer Effect */}
              <motion.div
                className="absolute inset-0 bg-linear-to-r from-transparent via-white/20 to-transparent"
                animate={{
                  x: ["-100%", "100%"],
                }}
                transition={{
                  repeat: Infinity,
                  duration: 3,
                  delay: 0.5,
                  ease: "easeInOut",
                }}
                style={{ pointerEvents: "none" }}
              />

              <span className="relative flex items-center justify-center gap-2">
                {isLoading ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{
                        repeat: Infinity,
                        duration: 1,
                        ease: "linear",
                      }}
                      className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                    />
                    Verifying...
                  </>
                ) : (
                  "Grant Access"
                )}
              </span>
            </motion.button>

            {/* Validation Helper Text */}
            {apiKey.length > 0 && !validateApiKey(apiKey) && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xs text-red-400/70 text-center"
              >
                API Key must be exactly 16 alphanumeric characters
              </motion.p>
            )}
          </form>

          {/* Footer Info */}
          <div className="pt-4 border-t border-white/5 space-y-2">
            <p className="text-xs text-zinc-500 text-center">
              Your API Key is validated locally and transmitted securely.
            </p>
            <p className="text-xs text-zinc-600 text-center">
              Never share your API Key with anyone.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
