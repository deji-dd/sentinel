"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ReactNode, useState } from "react";

type LegalType = "tos" | "privacy";

interface LegalSheetProps {
  type: LegalType;
  children: ReactNode;
}

export function LegalSheet({ type, children }: LegalSheetProps) {
  const [open, setOpen] = useState(false);

  const title = type === "tos" ? "Terms of Service" : "Privacy Policy";
  const description =
    type === "tos"
      ? "Please read our Terms of Service carefully before using Sentinel."
      : "How Sentinel collects, uses, and protects your data.";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="underline underline-offset-4 hover:text-primary cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >

        {children}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl md:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-8rem)] mt-6 pr-4 ps-4">
          <div className="space-y-6 text-sm text-muted-foreground">
            {type === "tos" ? (
              <>
                <div>
                  <h3 className="text-foreground font-medium mb-2">1. Acceptance of Terms</h3>
                  <p>By accessing and using the Sentinel bot and dashboard, you agree to be bound by these Terms of Service. If you disagree with any part of the terms, you may not access the service.</p>
                </div>
                <div>
                  <h3 className="text-foreground font-medium mb-2">2. Description of Service</h3>
                  <p>Sentinel provides Discord server management, moderation tools, and configuration dashboards. We reserve the right to modify, suspend, or discontinue the service at any time without notice.</p>
                </div>
                <div>
                  <h3 className="text-foreground font-medium mb-2">3. User Conduct</h3>
                  <p>You agree not to use the service for any unlawful purpose or in any way that could damage, disable, or impair the service. You are responsible for all activity that occurs under your Discord account.</p>
                </div>
                <div>
                  <h3 className="text-foreground font-medium mb-2">4. Limitation of Liability</h3>
                  <p>In no event shall Sentinel or its operators be liable for any indirect, incidental, special, consequential, or punitive damages arising out of your use or inability to use the service.</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <h3 className="text-foreground font-medium mb-2">1. Information We Collect</h3>
                  <p>When you log in, we collect your Discord User ID, username, and avatar URL. To provide bot functionality, we also access a list of servers you are a member of and your permissions within those servers.</p>
                </div>
                <div>
                  <h3 className="text-foreground font-medium mb-2">2. How We Use Your Information</h3>
                  <p>We use your information exclusively to authenticate you on the dashboard, verify your administrative permissions for specific servers, and provide the core bot services. We do not sell your personal data.</p>
                </div>
                <div>
                  <h3 className="text-foreground font-medium mb-2">3. Data Retention</h3>
                  <p>Your session data is securely encrypted and stored temporarily. Bot configuration data is retained as long as the bot remains in your server. If you kick the bot, all associated server configurations are eventually purged.</p>
                </div>
                <div>
                  <h3 className="text-foreground font-medium mb-2">4. Third-Party Services</h3>
                  <p>We use Discord API for authentication. Please refer to Discord&apos;s own Privacy Policy regarding how they handle your data on their platform.</p>
                </div>
              </>
            )}
            <p className="pt-8 text-xs opacity-50">Last updated: {new Date().toLocaleDateString()}</p>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
