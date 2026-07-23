"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus, ChevronDown, Pencil, Trash2, X } from "lucide-react";
import type { GuildConfigDocument, FactionRoleMappingDocument } from "@sentinel/shared";

interface VerificationTabProps {
  config: Partial<GuildConfigDocument>;
  setConfig: (config: Partial<GuildConfigDocument>) => void;
  verifiedRoles: string[];
  handleAddVerifiedRole: (roleId: string) => void;
  handleRemoveVerifiedRole: (roleId: string) => void;
  verifyOnJoinInput: boolean;
  setVerifyOnJoinInput: (val: boolean) => void;
  verifyCronInput: boolean;
  setVerifyCronInput: (val: boolean) => void;
  verifyCronIntervalInput: number;
  setVerifyCronIntervalInput: (val: number) => void;
  factionListChannelInput: string;
  setFactionListChannelInput: (val: string) => void;
  factionMappings: FactionRoleMappingDocument[];
  loadingMappings: boolean;
  roles: { id: string; name: string; color: number; position: number }[];
  channels: { id: string; name: string; type: number }[];
  handleOpenAddMapping: () => void;
  handleOpenEditMapping: (mapping: FactionRoleMappingDocument) => void;
  handleToggleMappingEnabled: (mapping: FactionRoleMappingDocument) => void;
  handleDeleteMapping: (id: string) => void;
  ensureArray: (val: unknown) => string[];
}

/**
 * Verification tab subview for verification policies, nickname template, roles, and faction role mappings table.
 */
export function VerificationTab({
  config,
  setConfig,
  verifiedRoles,
  handleAddVerifiedRole,
  handleRemoveVerifiedRole,
  verifyOnJoinInput,
  setVerifyOnJoinInput,
  verifyCronInput,
  setVerifyCronInput,
  verifyCronIntervalInput,
  setVerifyCronIntervalInput,
  factionListChannelInput,
  setFactionListChannelInput,
  factionMappings,
  loadingMappings,
  roles,
  channels,
  handleOpenAddMapping,
  handleOpenEditMapping,
  handleToggleMappingEnabled,
  handleDeleteMapping,
  ensureArray,
}: VerificationTabProps) {
  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight">Verification Settings</h2>
      </div>

      {/* Roles & Nicknames Card */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-blue-500 shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            Roles & Nicknames
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Nickname Template</label>
            <Input
              value={config.nickname_template || ""}
              onChange={(e) => setConfig({ ...config, nickname_template: e.target.value })}
              className="font-mono bg-zinc-50 dark:bg-zinc-900/30 border-zinc-200 dark:border-zinc-800 text-zinc-850 dark:text-zinc-200 focus-visible:ring-blue-500"
            />
            <p className="text-[10px] text-zinc-500">Available placeholders: <code className="text-zinc-650 dark:text-zinc-405 font-mono">{`{name}, {id}, {faction_tag}`}</code></p>
          </div>

          <div className="space-y-2.5">
            <div className="flex justify-between items-center">
              <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Verified Roles</label>
              <div className="relative">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      handleAddVerifiedRole(e.target.value);
                    }
                  }}
                  className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl py-1.5 pl-3 pr-8 text-xs text-zinc-700 dark:text-zinc-300 focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="">+ Add verified role...</option>
                  {roles
                    .filter((r) => r.name !== "@everyone" && !verifiedRoles.includes(r.id))
                    .map((role) => (
                      <option key={role.id} value={role.id} className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">
                        {role.name}
                      </option>
                    ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-500 dark:text-zinc-400">
                  <Plus className="size-3" />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 min-h-12 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/20">
              {verifiedRoles.length === 0 ? (
                <span className="text-xs text-zinc-400 dark:text-zinc-500 italic flex items-center">No default verified roles mapped.</span>
              ) : (
                verifiedRoles.map((roleId) => {
                  const roleObj = roles.find((r) => r.id === roleId);
                  return (
                    <Badge
                      key={roleId}
                      variant="secondary"
                      className="flex items-center gap-1.5 py-1 pl-2.5 pr-2 text-xs bg-zinc-100 dark:bg-zinc-900 text-zinc-850 dark:text-zinc-250 border border-zinc-200 dark:border-zinc-800 shadow-xs"
                    >
                      {roleObj ? roleObj.name : `Role: ${roleId}`}
                      <button
                        type="button"
                        onClick={() => handleRemoveVerifiedRole(roleId)}
                        className="text-zinc-400 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 rounded-full p-0.5 leading-none transition-colors cursor-pointer"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  );
                })
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Automation Tasks Card */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-emerald-505 shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            Auto-Verification Policies
          </CardTitle>

        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10">
            <div className="space-y-0.5">
              <label className="text-sm font-bold text-zinc-800 dark:text-zinc-200">Verify on Join</label>
              <p className="text-[10px] text-zinc-500">Instantly trigger verification when a new user enters the server.</p>
            </div>
            <Switch
              checked={verifyOnJoinInput}
              onCheckedChange={setVerifyOnJoinInput}
              className="data-[state=checked]:bg-emerald-500"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10">
            <div className="space-y-0.5">
              <label className="text-sm font-bold text-zinc-800 dark:text-zinc-200">Verify Background Cron</label>
              <p className="text-[10px] text-zinc-500">Enable scheduled background sweeps to keep Discord roles synced with faction mappings.</p>
            </div>
            <Switch
              checked={verifyCronInput}
              onCheckedChange={setVerifyCronInput}
              className="data-[state=checked]:bg-emerald-500"
            />
          </div>

          {verifyCronInput && (
            <div className="space-y-2.5 p-4 rounded-xl border border-dashed border-zinc-250 dark:border-zinc-800 bg-zinc-50/10 dark:bg-zinc-900/5 animate-in fade-in duration-300">
              <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Verify Cron Interval (hours)</label>
              <div className="relative w-full md:w-64">
                <select
                  value={verifyCronIntervalInput}
                  onChange={(e) => setVerifyCronIntervalInput(Number(e.target.value))}
                  className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2 px-3 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
                >
                  <option value={1}>Every 1 hour (Default)</option>
                  <option value={6}>Every 6 hours</option>
                  <option value={12}>Every 12 hours</option>
                  <option value={24}>Every 24 hours (Daily)</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 dark:text-zinc-400">
                  <ChevronDown className="size-4" />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Faction Maps Channel Card */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-purple-500 shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            Faction Mapping Logs
          </CardTitle>

        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Faction Map Channel</label>
            <div className="relative">
              <select
                value={factionListChannelInput}
                onChange={(e) => setFactionListChannelInput(e.target.value)}
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
            <p className="text-[10px] text-zinc-500">The channel in which faction configuration tables are posted and updated.</p>
          </div>
        </CardContent>
      </Card>

      {/* Faction Mappings Section */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-indigo-500 shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-bold">
              Faction Role Mappings
            </CardTitle>

          </div>
          <Button size="sm" variant="outline" className="text-xs border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 cursor-pointer" onClick={handleOpenAddMapping}>
            + Add Mapping
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingMappings ? (
            <p className="text-xs text-zinc-500 italic p-4 text-center">Loading mappings...</p>
          ) : factionMappings.length === 0 ? (
            <p className="text-xs text-zinc-500 italic p-4 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50/50 dark:bg-zinc-900/10">
              No faction mappings configured yet. Click &quot;+ Add Mapping&quot; above to create one.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 uppercase tracking-wider font-bold">
                    <th className="p-3">Faction ID</th>
                    <th className="p-3">Faction Name</th>
                    <th className="p-3">Member Roles</th>
                    <th className="p-3">Leader Roles</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-zinc-700 dark:text-zinc-300">
                  {factionMappings.map((mapping) => (
                    <tr key={mapping.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/10">
                      <td className="p-3 font-mono">{mapping.faction_id}</td>
                      <td className="p-3 font-medium">{mapping.faction_name || "Un-named Faction"}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {ensureArray(mapping.member_role_ids).length > 0 ? (
                            ensureArray(mapping.member_role_ids).map((rid) => {
                              const rObj = roles.find((r) => r.id === rid);
                              return (
                                <Badge key={rid} variant="secondary" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-[10px]">
                                  {rObj ? rObj.name : `Role: ${rid}`}
                                </Badge>
                              );
                            })
                          ) : (
                            <span className="text-[10px] text-zinc-400 italic">None</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {ensureArray(mapping.leader_role_ids).length > 0 ? (
                            ensureArray(mapping.leader_role_ids).map((rid) => {
                              const rObj = roles.find((r) => r.id === rid);
                              return (
                                <Badge key={rid} variant="secondary" className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 text-[10px]">
                                  {rObj ? rObj.name : `Role: ${rid}`}
                                </Badge>
                              );
                            })
                          ) : (
                            <span className="text-[10px] text-zinc-400 italic">None</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <Switch
                          checked={mapping.enabled}
                          onCheckedChange={() => handleToggleMappingEnabled(mapping)}
                        />
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button size="icon" variant="ghost" className="size-8 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" onClick={() => handleOpenEditMapping(mapping)}>
                            <Pencil className="size-3.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-8 cursor-pointer hover:bg-red-500/10" onClick={() => handleDeleteMapping(mapping.id)}>
                            <Trash2 className="size-3.5 text-red-500 hover:text-red-600" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
