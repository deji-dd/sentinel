"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const apiKeySchema = z.object({
  apiKey: z
    .string()
    .length(16, "API Key must be exactly 16 characters.")
    .regex(/^[a-zA-Z0-9]+$/, "API Key must be alphanumeric."),
});

type FormData = z.infer<typeof apiKeySchema>;

export function OnboardingForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, control, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: {
      apiKey: "",
    }
  });

  const currentKey = useWatch({ control, name: "apiKey" }) || "";

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const resData = await res.json();

      if (!res.ok) {
        throw new Error(resData.error || "Failed to initialize");
      }

      toast.success("Sentinel core initialized.", {
        style: {
          background: "#111",
          border: "1px solid #333",
          color: "#fff",
          fontFamily: "var(--font-geist-mono)",
        }
      });

      router.push("/");
      router.refresh();

    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Initialization failed", {
        style: {
          background: "#111",
          border: "1px solid #ff3333",
          color: "#ff3333",
          fontFamily: "var(--font-geist-mono)",
        }
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isComplete = currentKey.length === 16;

  return (
    <motion.form
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 1, ease: "easeOut" }}
      onSubmit={handleSubmit(onSubmit)}
      className="w-full flex flex-col items-center space-y-12 px-6"
    >
      <div className="relative w-full group">
        <input
          {...register("apiKey")}
          type="text"
          maxLength={16}
          placeholder="ENTER FULL ACCESS KEY"
          className="w-full bg-transparent border-b border-neutral-900 text-center font-mono text-2xl tracking-[0.15em] sm:tracking-[0.2em] md:text-4xl uppercase text-neutral-200 placeholder:text-neutral-800 focus:outline-none focus:border-white transition-colors duration-500 py-6 px-2 caret-white"
          autoComplete="off"
          spellCheck="false"
          disabled={isSubmitting}
        />
        <div className="absolute -bottom-[1px] left-1/2 w-0 h-[1px] bg-white transition-all duration-700 ease-out group-focus-within:w-full group-focus-within:left-0" />
      </div>

      <div className="h-4 flex items-center justify-center w-full">
        <AnimatePresence mode="wait">
          {errors.apiKey ? (
            <motion.p
              key="error"
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-red-500 text-[10px] sm:text-xs font-mono tracking-[0.2em] uppercase"
            >
              {errors.apiKey.message}
            </motion.p>
          ) : (
            <motion.p
              key="counter"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-neutral-700 text-[10px] sm:text-xs font-mono tracking-[0.2em]"
            >
              {currentKey.length} / 16
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="h-16 w-full flex justify-center items-center">
        <AnimatePresence>
          {isComplete && !errors.apiKey && (
            <motion.button
              type="submit"
              disabled={isSubmitting}
              initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 10, filter: "blur(4px)" }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="group relative px-10 py-4 bg-white text-black font-mono text-xs uppercase tracking-[0.3em] overflow-hidden rounded-sm"
            >
              <span className="relative z-10 flex items-center gap-2 font-semibold">
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    ESTABLISHING_LINK...
                  </>
                ) : (
                  "INITIALIZE"
                )}
              </span>
              <div className="absolute inset-0 bg-neutral-200 translate-y-[101%] group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.form>
  );
}
