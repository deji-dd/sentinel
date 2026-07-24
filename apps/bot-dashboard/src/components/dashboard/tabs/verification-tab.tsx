"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  ChevronDown,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import type {
  GuildConfigDocument,
  FactionRoleMappingDocument,
} from "@sentinel/shared";

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
  strictFactionRoles: string[];
  handleAddStrictFactionRole: (roleId: string) => void;
  handleRemoveStrictFactionRole: (roleId: string) => void;
  ensureArray: (val: unknown) => string[];
}

/**
 * Verification tab subview for verification policies, nickname template, roles, and faction role mappings table with pagination.
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
  strictFactionRoles,
  handleAddStrictFactionRole,
  handleRemoveStrictFactionRole,
  ensureArray,
}: VerificationTabProps) {
  // Pagination state for Faction Role Mappings
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const totalPages = Math.max(1, Math.ceil(factionMappings.length / pageSize));
  const validPage = Math.min(currentPage, totalPages);
  const startIndex = (validPage - 1) * pageSize;
  const paginatedMappings = factionMappings.slice(
    startIndex,
    startIndex + pageSize,
  );

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight">
          Verification Configuration
        </h2>
      </div>

      {/* Verification Parameters Card */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-blue-500 shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            Verification Parameters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">
              Verified Member Roles
            </label>
            <div className="relative">
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleAddVerifiedRole(e.target.value);
                    e.target.value = "";
                  }
                }}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2.5 pl-3.5 pr-10 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
              >
                <option
                  value=""
                  className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200"
                >
                  + Add Verified Role...
                </option>
                {roles
                  .filter((r) => !verifiedRoles.includes(r.id))
                  .map((role) => (
                    <option
                      key={role.id}
                      value={role.id}
                      className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200"
                    >
                      @{role.name}
                    </option>
                  ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 dark:text-zinc-400">
                <ChevronDown className="size-4" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {verifiedRoles.length === 0 ? (
                <span className="text-xs text-zinc-400 italic">
                  No verified roles added.
                </span>
              ) : (
                verifiedRoles.map((roleId) => {
                  const roleObj = roles.find((r) => r.id === roleId);
                  return (
                    <Badge
                      key={roleId}
                      variant="secondary"
                      className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-xs px-2.5 py-1 rounded-lg flex items-center gap-1.5"
                    >
                      <span>{roleObj ? roleObj.name : `Role: ${roleId}`}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveVerifiedRole(roleId)}
                        className="text-zinc-400 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 rounded-full p-0.5 leading-none transition-colors cursor-pointer"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </Badge>
                  );
                })
              )}
            </div>
            <p className="text-[10px] text-zinc-500">
              Roles assigned to users upon successful Torn verification.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">
              Nickname Template
            </label>
            <Input
              value={config.nickname_template || "{name} [{id}]"}
              onChange={(e) =>
                setConfig({ ...config, nickname_template: e.target.value })
              }
              placeholder="{name} [{id}]"
              className="bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
            />
            <p className="text-[10px] text-zinc-500">
              Available tags:{" "}
              <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">
                {"{name}"}
              </code>
              ,{" "}
              <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">
                {"{id}"}
              </code>
              ,{" "}
              <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">
                {"{tag}"}
              </code>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Verification Automation Policies */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-emerald-500 shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            Automation & Cron Policies
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10">
            <div className="space-y-0.5">
              <span className="text-sm font-bold text-zinc-900 dark:text-white">
                Verify On Join
              </span>
              <p className="text-xs text-zinc-500">
                Automatically verify users when they join the server if their
                Discord account is linked on Torn.
              </p>
            </div>
            <Switch
              checked={verifyOnJoinInput}
              onCheckedChange={setVerifyOnJoinInput}
            />
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10">
            <div className="space-y-0.5">
              <span className="text-sm font-bold text-zinc-900 dark:text-white">
                Background Cron Verification
              </span>
              <p className="text-xs text-zinc-500">
                Periodically check member status against Torn API to update
                faction roles & nicknames.
              </p>
            </div>
            <Switch
              checked={verifyCronInput}
              onCheckedChange={setVerifyCronInput}
            />
          </div>

          {verifyCronInput && (
            <div className="space-y-2 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/40">
              <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">
                Cron Verification Frequency
              </label>
              <div className="relative max-w-sm">
                <select
                  value={verifyCronIntervalInput}
                  onChange={(e) =>
                    setVerifyCronIntervalInput(Number(e.target.value))
                  }
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

      {/* Strict Faction Role Guard (Strip Unmapped Roles) Card */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-red-500 shadow-xs">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-red-500" />
            <CardTitle className="text-lg font-bold">
              Strict Faction Role Guard
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">
              Strip Roles If Not In Mapped Faction
            </label>
            <div className="relative">
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleAddStrictFactionRole(e.target.value);
                    e.target.value = "";
                  }
                }}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2.5 pl-3.5 pr-10 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
              >
                <option
                  value=""
                  className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200"
                >
                  + Add Protected Role to Auto-Strip...
                </option>
                {roles
                  .filter((r) => !strictFactionRoles.includes(r.id))
                  .map((role) => (
                    <option
                      key={role.id}
                      value={role.id}
                      className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200"
                    >
                      @{role.name}
                    </option>
                  ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 dark:text-zinc-400">
                <ChevronDown className="size-4" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {strictFactionRoles.length === 0 ? (
                <span className="text-xs text-zinc-400 italic">
                  No strict protected roles configured.
                </span>
              ) : (
                strictFactionRoles.map((roleId) => {
                  const roleObj = roles.find((r) => r.id === roleId);
                  return (
                    <Badge
                      key={roleId}
                      variant="secondary"
                      className="bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 text-xs px-2.5 py-1 rounded-lg flex items-center gap-1.5"
                    >
                      <span>{roleObj ? roleObj.name : `Role: ${roleId}`}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveStrictFactionRole(roleId)}
                        className="text-zinc-400 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 rounded-full p-0.5 leading-none transition-colors cursor-pointer"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </Badge>
                  );
                })
              )}
            </div>
            <p className="text-[10px] text-zinc-500">
              Sentinel will automatically strip these roles from any member who
              is assigned them if they are ever not in one of the server&apos;s
              mapped factions.
            </p>
          </div>
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
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">
              Faction Map Channel
            </label>
            <div className="relative">
              <select
                value={factionListChannelInput}
                onChange={(e) => setFactionListChannelInput(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2.5 pl-3.5 pr-10 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
              >
                <option
                  value=""
                  className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200"
                >
                  None (Select Log Channel...)
                </option>
                {channels
                  .filter((c) => c.type === 0 || c.type === 5)
                  .map((chan) => (
                    <option
                      key={chan.id}
                      value={chan.id}
                      className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200"
                    >
                      #{chan.name}
                    </option>
                  ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 dark:text-zinc-400">
                <ChevronDown className="size-4" />
              </div>
            </div>
            <p className="text-[10px] text-zinc-500">
              The channel in which faction configuration tables are posted and
              updated.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Faction Mappings Section with Pagination */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-indigo-500 shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-bold">
              Faction Role Mappings
            </CardTitle>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-xs border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 cursor-pointer"
            onClick={handleOpenAddMapping}
          >
            + Add Mapping
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingMappings ? (
            <p className="text-xs text-zinc-500 italic p-4 text-center">
              Loading mappings...
            </p>
          ) : factionMappings.length === 0 ? (
            <p className="text-xs text-zinc-500 italic p-4 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50/50 dark:bg-zinc-900/10">
              No faction mappings configured yet. Click &quot;+ Add Mapping&quot;
              above to create one.
            </p>
          ) : (
            <div className="space-y-4">
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
                    {paginatedMappings.map((mapping) => (
                      <tr
                        key={mapping.id}
                        className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/10"
                      >
                        <td className="p-3 font-mono">{mapping.faction_id}</td>
                        <td className="p-3 font-medium">
                          {mapping.faction_name || "Un-named Faction"}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {ensureArray(mapping.member_role_ids).length > 0 ? (
                              ensureArray(mapping.member_role_ids).map(
                                (rid) => {
                                  const rObj = roles.find((r) => r.id === rid);
                                  return (
                                    <Badge
                                      key={rid}
                                      variant="secondary"
                                      className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-[10px]"
                                    >
                                      {rObj ? rObj.name : `Role: ${rid}`}
                                    </Badge>
                                  );
                                },
                              )
                            ) : (
                              <span className="text-[10px] text-zinc-400 italic">
                                None
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {ensureArray(mapping.leader_role_ids).length > 0 ? (
                              ensureArray(mapping.leader_role_ids).map(
                                (rid) => {
                                  const rObj = roles.find((r) => r.id === rid);
                                  return (
                                    <Badge
                                      key={rid}
                                      variant="secondary"
                                      className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 text-[10px]"
                                    >
                                      {rObj ? rObj.name : `Role: ${rid}`}
                                    </Badge>
                                  );
                                },
                              )
                            ) : (
                              <span className="text-[10px] text-zinc-400 italic">
                                None
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <Switch
                            checked={mapping.enabled}
                            onCheckedChange={() =>
                              handleToggleMappingEnabled(mapping)
                            }
                          />
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                              onClick={() => handleOpenEditMapping(mapping)}
                            >
                              <Pencil className="size-3.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 cursor-pointer hover:bg-red-500/10"
                              onClick={() => handleDeleteMapping(mapping.id)}
                            >
                              <Trash2 className="size-3.5 text-red-500 hover:text-red-600" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {factionMappings.length > pageSize && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 px-1 text-xs text-zinc-500">
                  <span>
                    Showing{" "}
                    <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {startIndex + 1}
                    </strong>{" "}
                    to{" "}
                    <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {Math.min(startIndex + pageSize, factionMappings.length)}
                    </strong>{" "}
                    of{" "}
                    <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {factionMappings.length}
                    </strong>{" "}
                    mappings
                  </span>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                      disabled={validPage === 1}
                      className="h-8 px-2.5 text-xs font-semibold border-zinc-200 dark:border-zinc-800 cursor-pointer disabled:opacity-40"
                    >
                      <ChevronLeft className="size-3.5 mr-1" />
                      Previous
                    </Button>
                    <span className="px-2 font-medium">
                      Page {validPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((p) => Math.min(p + 1, totalPages))
                      }
                      disabled={validPage === totalPages}
                      className="h-8 px-2.5 text-xs font-semibold border-zinc-200 dark:border-zinc-800 cursor-pointer disabled:opacity-40"
                    >
                      Next
                      <ChevronRight className="size-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
