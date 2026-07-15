import { ReactNode } from "react";
import { SettingsProvider } from "@/components/settings-provider";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}

