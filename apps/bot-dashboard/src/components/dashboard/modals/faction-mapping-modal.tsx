"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Search, ChevronDown } from "lucide-react";
import type { FactionRoleMappingDocument } from "@sentinel/shared";

interface FactionMappingModalProps {
  showMappingModal: boolean;
  setShowMappingModal: (val: boolean) => void;
  editingMapping: FactionRoleMappingDocument | null;
  formFactionId: string;
  setFormFactionId: (val: string) => void;
  formFactionName: string;
  isFetchingFactionName: boolean;
  handleFetchFactionName: () => void;
  formEnabled: boolean;
  setFormEnabled: (val: boolean) => void;
  formMemberRoles: string[];
  setFormMemberRoles: (roles: string[]) => void;
  formLeaderRoles: string[];
  setFormLeaderRoles: (roles: string[]) => void;
  roles: { id: string; name: string; color: number; position: number }[];
  handleSaveMapping: () => void;
  savingMapping: boolean;
  ensureArray: (val: unknown) => string[];
}

/**
 * Faction Role Mapping Modal for adding or editing Torn Faction role mappings.
 */
export function FactionMappingModal({
  showMappingModal,
  setShowMappingModal,
  editingMapping,
  formFactionId,
  setFormFactionId,
  formFactionName,
  isFetchingFactionName,
  handleFetchFactionName,
  formEnabled,
  setFormEnabled,
  formMemberRoles,
  setFormMemberRoles,
  formLeaderRoles,
  setFormLeaderRoles,
  roles,
  handleSaveMapping,
  savingMapping,
  ensureArray,
}: FactionMappingModalProps) {
  if (!showMappingModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="max-w-lg w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-850 rounded-2xl p-6 shadow-2xl space-y-4 mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
            {editingMapping ? "Edit Faction Role Mapping" : "Add Faction Role Mapping"}
          </h3>
          <button onClick={() => setShowMappingModal(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Faction ID</label>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="e.g. 8000"
                value={formFactionId}
                onChange={(e) => setFormFactionId(e.target.value)}
                disabled={!!editingMapping}
                className="flex-1 bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-zinc-800 dark:text-zinc-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              {!editingMapping && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleFetchFactionName}
                  disabled={isFetchingFactionName || !formFactionId.trim()}
                  className="h-10 px-3.5 text-xs border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/80 hover:bg-zinc-100 dark:hover:bg-zinc-850 cursor-pointer font-medium"
                >
                  <Search className="size-3.5 mr-1.5 text-zinc-500" />
                  {isFetchingFactionName ? "Fetching..." : "Fetch Name"}
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Faction Name</label>
            <Input
              value={formFactionName}
              disabled={true}
              readOnly={true}
              placeholder={
                editingMapping
                  ? "Faction Name"
                  : isFetchingFactionName
                  ? "Fetching faction name..."
                  : "Click 'Fetch Name' to load name"
              }
              className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-zinc-800 dark:text-zinc-300 cursor-not-allowed opacity-80"
            />
            {!editingMapping && (
              <p className="text-[10px] text-zinc-500">Faction details are cached locally in NoSQL DB to prevent API spam.</p>
            )}
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10">
            <div className="space-y-0.5">
              <label className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Mapping Enabled</label>
              <p className="text-[10px] text-zinc-500">Active mappings automatically apply roles during verification.</p>
            </div>
            <input
              type="checkbox"
              checked={formEnabled}
              onChange={(e) => setFormEnabled(e.target.checked)}
              className="size-4 accent-indigo-500 rounded cursor-pointer"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Member Roles</label>
            <div className="flex flex-wrap gap-1.5 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10 min-h-12">
              {ensureArray(formMemberRoles).map((rid) => {
                const rObj = roles.find((r) => r.id === rid);
                return (
                  <Badge key={rid} variant="secondary" className="flex items-center gap-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-xs">
                    {rObj ? rObj.name : rid}
                    <X
                      className="size-3 cursor-pointer hover:text-red-500"
                      onClick={() => setFormMemberRoles(ensureArray(formMemberRoles).filter((id) => id !== rid))}
                    />
                  </Badge>
                );
              })}
            </div>
            <div className="relative">
              <select
                value=""
                onChange={(e) => {
                  const val = e.target.value;
                  const current = ensureArray(formMemberRoles);
                  if (val && !current.includes(val)) {
                    setFormMemberRoles([...current, val]);
                  }
                }}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2.5 pl-3.5 pr-10 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
              >
                <option value="" className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">Select a role to add...</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id} className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">{r.name}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500">
                <ChevronDown className="size-4" />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Leader Roles</label>
            <div className="flex flex-wrap gap-1.5 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10 min-h-12">
              {ensureArray(formLeaderRoles).map((rid) => {
                const rObj = roles.find((r) => r.id === rid);
                return (
                  <Badge key={rid} variant="secondary" className="flex items-center gap-1 bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 text-xs">
                    {rObj ? rObj.name : rid}
                    <X
                      className="size-3 cursor-pointer hover:text-red-500"
                      onClick={() => setFormLeaderRoles(ensureArray(formLeaderRoles).filter((id) => id !== rid))}
                    />
                  </Badge>
                );
              })}
            </div>
            <div className="relative">
              <select
                value=""
                onChange={(e) => {
                  const val = e.target.value;
                  const current = ensureArray(formLeaderRoles);
                  if (val && !current.includes(val)) {
                    setFormLeaderRoles([...current, val]);
                  }
                }}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2.5 pl-3.5 pr-10 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
              >
                <option value="" className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">Select a role to add...</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id} className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">{r.name}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500">
                <ChevronDown className="size-4" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end pt-4 border-t border-zinc-200 dark:border-zinc-800">
          <Button
            variant="ghost"
            onClick={() => setShowMappingModal(false)}
            className="font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-white cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveMapping}
            disabled={savingMapping || !formFactionId.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-5 rounded-xl cursor-pointer"
          >
            {savingMapping ? "Saving..." : "Save Mapping"}
          </Button>
        </div>
      </div>
    </div>
  );
}
