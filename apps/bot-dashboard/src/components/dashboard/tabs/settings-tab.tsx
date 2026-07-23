"use client";

import { useState } from "react";
import { toast } from "sonner";
import { deployGuildSlashCommandsAction } from "@/actions/guilds";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, Trash2, KeyRound, Terminal, Loader2 } from "lucide-react";
import type { MaskedGuildApiKey } from "@sentinel/shared";

interface SettingsTabProps {
  guildId?: string;
  isBotOwner?: boolean;
  logChannelInput: string;
  setLogChannelInput: (val: string) => void;
  channels: { id: string; name: string; type: number }[];
  roles: { id: string; name: string; color: number; position: number }[];
  adminRoleIdsInput: string[];
  handleAddAdminRole: (roleId: string) => void;
  handleRemoveAdminRole: (roleId: string) => void;
  apiKeysList: MaskedGuildApiKey[];
  apiKeyInput: string;
  setApiKeyInput: (val: string) => void;
  addingApiKey: boolean;
  handleAddApiKey: () => void;
  handleDeleteApiKey: (keyId: string) => void;
  handleSetApiKeyPrimary: (keyId: string) => void;
  setShowDeinitModal: (val: boolean) => void;
}

/**
 * Settings tab subview for core parameters, log channels, API keys, admin access control, and danger zone.
 */
export function SettingsTab({
  guildId,
  isBotOwner,
  logChannelInput,
  setLogChannelInput,
  channels,
  roles,
  adminRoleIdsInput,
  handleAddAdminRole,
  handleRemoveAdminRole,
  apiKeysList,
  apiKeyInput,
  setApiKeyInput,
  addingApiKey,
  handleAddApiKey,
  handleDeleteApiKey,
  handleSetApiKeyPrimary,
  setShowDeinitModal,
}: SettingsTabProps) {
  const [isDeploying, setIsDeploying] = useState(false);

  const handleDeployCommands = async () => {
    if (!guildId) return;
    setIsDeploying(true);
    try {
      const res = await deployGuildSlashCommandsAction(guildId);
      if (res.success) {
        toast.success(res.message || "Slash commands deployed successfully!");
      } else {
        toast.error(res.error || "Failed to deploy slash commands.");
      }
    } catch {
      toast.error("An error occurred deploying slash commands.");
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold tracking-tight">Core Settings</h2>
        </div>

        {isBotOwner && guildId && (
          <Button
            onClick={handleDeployCommands}
            disabled={isDeploying}
            variant="outline"
            className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-500/30 text-xs font-bold h-9 px-3.5 cursor-pointer shadow-xs gap-1.5 shrink-0"
          >
            {isDeploying ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Terminal className="size-3.5 text-purple-500" />
            )}
            Deploy Slash Commands
          </Button>
        )}
      </div>

      {/* Core Parameters Card */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-slate-500 shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            Core Parameters
          </CardTitle>

        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">System Log Channel</label>
            <div className="relative">
              <select
                value={logChannelInput}
                onChange={(e) => setLogChannelInput(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2.5 pl-3.5 pr-10 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
              >
                <option value="" className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">None (Select Log Channel...)</option>
                {channels
                  .filter((c) => c.type === 0 || c.type === 5)
                  .map((chan) => (
                    <option key={chan.id} value={chan.id} className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">
                      #{chan.name}
                    </option>
                  ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 dark:text-zinc-400">
                <ChevronDown className="size-4" />
              </div>
            </div>
            <p className="text-[10px] text-zinc-500">Destination channel for bot administrative updates, errors, and system audit logs.</p>
          </div>
        </CardContent>
      </Card>

      {/* API Keys Card */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-amber-500 shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            API Keys
          </CardTitle>

        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Add New API Key</label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Enter 16-character Torn API key..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-zinc-800 dark:text-zinc-300 font-mono"
              />
              <Button
                onClick={handleAddApiKey}
                disabled={addingApiKey || !apiKeyInput.trim()}
                className="bg-zinc-900 dark:bg-white text-white dark:text-black font-bold px-4 cursor-pointer"
              >
                {addingApiKey ? "Verifying..." : "Add Key"}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Registered API Keys</label>
            {apiKeysList.length === 0 ? (
              <p className="text-xs text-zinc-500 italic p-3 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">No API keys registered yet.</p>
            ) : (
              <div className="space-y-2">
                {apiKeysList.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10"
                  >
                    <div className="flex items-center gap-3">
                      <KeyRound className="size-4 text-amber-500" />
                      <div>
                        <span className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">{key.masked}</span>
                        {key.provided_by && (
                          <p className="text-[10px] text-zinc-500">Provided by: {key.provided_by}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {key.is_primary ? (
                        <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-mono">
                          PRIMARY KEY
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSetApiKeyPrimary(key.id)}
                          className="text-[10px] h-7 px-2.5 cursor-pointer"
                        >
                          Set Primary
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDeleteApiKey(key.id)}
                        className="size-7 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 cursor-pointer"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Admin Roles Card */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-red-500 shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            Admin Access Control
          </CardTitle>

        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Admin Roles</label>
              <div className="relative">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) handleAddAdminRole(e.target.value);
                  }}
                  className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-1.5 pl-3 pr-8 text-xs text-zinc-700 dark:text-zinc-300 focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="">+ Add admin role...</option>
                  {roles
                    .filter((r) => r.name !== "@everyone" && !adminRoleIdsInput.includes(r.id))
                    .map((role) => (
                      <option key={role.id} value={role.id} className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">
                        {role.name}
                      </option>
                    ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-500 dark:text-zinc-400">
                  <ChevronDown className="size-3" />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 min-h-12 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/20">
              {adminRoleIdsInput.length === 0 ? (
                <span className="text-xs text-zinc-400 dark:text-zinc-500 italic flex items-center">No specific admin roles mapped. (Server Administrators have full access).</span>
              ) : (
                adminRoleIdsInput.map((roleId) => {
                  const roleObj = roles.find((r) => r.id === roleId);
                  return (
                    <Badge
                      key={roleId}
                      variant="secondary"
                      className="flex items-center gap-1.5 py-1 pl-2.5 pr-2 text-xs bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 shadow-xs"
                    >
                      {roleObj ? roleObj.name : `Role: ${roleId}`}
                      <button
                        type="button"
                        onClick={() => handleRemoveAdminRole(roleId)}
                        className="text-zinc-400 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 rounded-full p-0.5 leading-none transition-colors cursor-pointer"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </Badge>
                  );
                })
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone - Admin Only */}
      {isBotOwner && (
        <Card className="bg-red-500/5 border border-red-500/20 dark:bg-red-950/10 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-red-600 dark:text-red-400">
              Danger Zone
            </CardTitle>

          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl border border-red-500/20 bg-white/40 dark:bg-black/40">
              <div className="space-y-1">
                <span className="text-sm font-bold text-zinc-900 dark:text-white">Deinitialize Guild</span>
                <p className="text-xs text-zinc-500">Wipe all stored configuration, role mappings, and API keys for this guild.</p>
              </div>
              <Button
                variant="destructive"
                onClick={() => setShowDeinitModal(true)}
                className="bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer"
              >
                Deinitialize
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
