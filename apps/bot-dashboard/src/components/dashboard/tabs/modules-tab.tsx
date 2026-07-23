"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { SystemModuleDocument } from "@sentinel/shared";

interface ModulesTabProps {
  systemModules: SystemModuleDocument[];
  enabledModulesInput: string[];
  handleToggleModule: (moduleId: string) => void;
}

/**
 * Modules tab subview for bot owners to toggle system modules.
 */
export function ModulesTab({
  systemModules,
  enabledModulesInput,
  handleToggleModule,
}: ModulesTabProps) {
  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight">System Modules</h2>
      </div>

      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-indigo-500 shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            Module Toggles
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {systemModules.map((mod) => {
            const isEnabled = enabledModulesInput.includes(mod.module_id);
            return (
              <div
                key={mod.module_id}
                className="flex items-center justify-between p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10"
              >
                <span className="text-sm font-bold text-zinc-900 dark:text-white">{mod.name}</span>
                <Switch
                  checked={isEnabled}
                  onCheckedChange={() => handleToggleModule(mod.module_id)}
                  className="data-[state=checked]:bg-indigo-500 cursor-pointer"
                />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
