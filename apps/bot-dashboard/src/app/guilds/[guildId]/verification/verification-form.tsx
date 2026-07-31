"use client";

import React, { useState, useTransition } from "react";
import {
  updateVerificationSettings,
  addFactionRoleMapping,
  deleteFactionRoleMapping,
  updateFactionRoleMapping,
  lookupFaction,
} from "@/actions/guilds";
import {
  Save,
  Plus,
  X,
  Trash2,
  Loader2,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

interface FactionMapping {
  id: string;
  factionId: number;
  factionName: string | null;
  factionTag: string | null;
  tagImage: string | null;
  memberRoleIds: string[];
  leaderRoleIds: string[];
  enabled: boolean;
}

/** A mapping staged for addition but not yet persisted. */
interface PendingMapping {
  /** Client-side temp ID to track the row before it's saved. */
  tempId: string;
  factionId: number;
  factionName: string | null;
  memberRoleIds: string[];
  leaderRoleIds: string[];
}

interface VerificationFormProps {
  guildId: string;
  initialConfig: {
    verifiedRoleIds: string[];
    nicknameTemplate: string | null;
    verifyOnJoin: boolean;
    verifyCron: boolean;
    verifyCronInterval: number;
    protectedRoleIds: string[];
    factionListChannelId: string | null;
    factionRoleMappings: FactionMapping[];
  };
  roles: { id: string; name: string; color: number }[];
  channels: { id: string; name: string; type: number }[];
}

/** Formats a Discord role colour integer as a CSS hex string. */
function roleColor(color: number): string {
  if (!color) return "#64748b";
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** A reusable tag pill for selected roles. */
function RoleTag({
  roleId,
  roles,
  onRemove,
  accentClass = "bg-blue-600/10 border-blue-500/30 text-blue-300",
}: {
  roleId: string;
  roles: { id: string; name: string; color: number }[];
  onRemove: () => void;
  accentClass?: string;
}) {
  const role = roles.find((r) => r.id === roleId);
  const name = role ? `@${role.name}` : roleId;
  return (
    <span
      className={`inline-flex items-center gap-2 py-1.5 px-3.5 rounded-xl border text-xs font-medium font-mono ${accentClass}`}
    >
      {role && (
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: roleColor(role.color) }}
        />
      )}
      <span>{name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="p-0.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
        title="Remove"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}

/** A reusable role selector + add button pair. */
function RoleAdder({
  roles,
  selected,
  onAdd,
  placeholder = "-- Select Role --",
  accentFocus = "focus:border-blue-500/50",
  buttonClass = "bg-blue-600 hover:bg-blue-500 shadow-blue-600/20",
}: {
  roles: { id: string; name: string; color: number }[];
  selected: string[];
  onAdd: (id: string) => void;
  placeholder?: string;
  accentFocus?: string;
  buttonClass?: string;
}) {
  const [input, setInput] = useState("");
  const available = roles.filter((r) => !selected.includes(r.id));

  const handleAdd = () => {
    if (!input) return;
    if (selected.includes(input)) {
      toast.warning("Role already added.");
      return;
    }
    onAdd(input);
    setInput("");
  };

  return (
    <div className="flex gap-2.5 max-w-md">
      {roles.length > 0 ? (
        <select
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className={`flex-1 h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-sans focus:outline-none ${accentFocus} transition-colors cursor-pointer`}
        >
          <option value="">{placeholder}</option>
          {available.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter Discord Role ID"
          className={`flex-1 h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-mono focus:outline-none ${accentFocus} transition-colors`}
        />
      )}
      <button
        type="button"
        onClick={handleAdd}
        className={`h-11 py-2.5 px-4 rounded-xl text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-lg cursor-pointer shrink-0 ${buttonClass}`}
      >
        <Plus className="w-4 h-4" />
        Add
      </button>
    </div>
  );
}

/** Toggle switch component. */
function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5 px-4 rounded-2xl bg-slate-900/60 border border-slate-800/80">
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        {description && (
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 cursor-pointer focus:outline-none ${checked ? "bg-blue-600" : "bg-slate-700"
          }`}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-0"
            }`}
        />
      </button>
    </div>
  );
}

/** Expandable faction mapping card — delete is staged, not immediate. Edits save immediately. */
function FactionMappingCard({
  mapping,
  roles,
  guildId,
  isPendingDelete,
  onToggleDelete,
  onUpdated,
}: {
  mapping: FactionMapping;
  roles: { id: string; name: string; color: number }[];
  guildId: string;
  isPendingDelete: boolean;
  onToggleDelete: () => void;
  onUpdated: (updated: FactionMapping) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editMemberRoles, setEditMemberRoles] = useState<string[]>(mapping.memberRoleIds);
  const [editLeaderRoles, setEditLeaderRoles] = useState<string[]>(mapping.leaderRoleIds);
  const [isSavingEdit, startSavingEdit] = useTransition();

  const handleEditSave = () => {
    startSavingEdit(async () => {
      const res = await updateFactionRoleMapping(guildId, mapping.id, {
        factionId: mapping.factionId,
        factionName: mapping.factionName,
        memberRoleIds: editMemberRoles,
        leaderRoleIds: editLeaderRoles,
      });
      if (res.success) {
        onUpdated({
          ...mapping,
          memberRoleIds: editMemberRoles,
          leaderRoleIds: editLeaderRoles,
        });
        setEditing(false);
        toast.success("Mapping updated.");
      } else {
        toast.error(res.error || "Failed to update mapping.");
      }
    });
  };

  const handleEditCancel = () => {
    setEditMemberRoles(mapping.memberRoleIds);
    setEditLeaderRoles(mapping.leaderRoleIds);
    setEditing(false);
  };

  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-colors ${isPendingDelete
        ? "bg-red-950/30 border-red-500/30"
        : "bg-slate-900/80 border-slate-800"
        }`}
    >
      <div className="p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {/* Faction tag image or ID badge */}
          <div className="shrink-0 w-9 h-9 flex items-center justify-center overflow-hidden">
            {mapping.tagImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`https://factiontags.torn.com/${mapping.tagImage}`}
                alt={mapping.factionTag || String(mapping.factionId)}
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-[10px] font-mono font-bold text-slate-400">
                {mapping.factionTag || mapping.factionId}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p
                className={`text-sm font-semibold truncate ${isPendingDelete ? "line-through text-slate-500" : "text-white"
                  }`}
              >
                {mapping.factionName || `Faction #${mapping.factionId}`}
              </p>
              {isPendingDelete && (
                <span className="shrink-0 px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 text-[10px] font-mono font-bold">
                  PENDING REMOVAL
                </span>
              )}
            </div>
            <p className="text-[11px] font-mono text-slate-500 mt-0.5">
              {mapping.memberRoleIds.length} member{" "}
              {mapping.memberRoleIds.length !== 1 ? "roles" : "role"} ·{" "}
              {mapping.leaderRoleIds.length} leader{" "}
              {mapping.leaderRoleIds.length !== 1 ? "roles" : "role"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isPendingDelete && (
            <>
              <button
                type="button"
                onClick={() => {
                  setExpanded((v) => !v);
                  if (editing) handleEditCancel();
                }}
                className="h-8 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {expanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                {expanded ? "Collapse" : "Expand"}
              </button>
              {expanded && (
                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  className="h-8 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {editing ? "Cancel" : "Edit"}
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={onToggleDelete}
            className={`p-2 rounded-xl border transition-all cursor-pointer ${isPendingDelete
              ? "bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700"
              : "bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/20"
              }`}
            title={isPendingDelete ? "Restore mapping" : "Stage for removal"}
          >
            {isPendingDelete ? (
              <RotateCcw className="w-4 h-4" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-800 space-y-4">
          {editing ? (
            /* ---- Edit mode ---- */
            <>
              <div className="space-y-2">
                <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400">
                  Member Roles
                </p>
                <RoleAdder
                  roles={roles}
                  selected={editMemberRoles}
                  onAdd={(id) => setEditMemberRoles((prev) => [...prev, id])}
                  placeholder="-- Add Member Role --"
                />
                <div className="flex flex-wrap gap-2">
                  {editMemberRoles.map((id) => (
                    <RoleTag
                      key={id}
                      roleId={id}
                      roles={roles}
                      onRemove={() =>
                        setEditMemberRoles((prev) => prev.filter((r) => r !== id))
                      }
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400">
                  Leader Roles
                </p>
                <RoleAdder
                  roles={roles}
                  selected={editLeaderRoles}
                  onAdd={(id) => setEditLeaderRoles((prev) => [...prev, id])}
                  placeholder="-- Add Leader Role --"
                  accentFocus="focus:border-purple-500/50"
                  buttonClass="bg-purple-600 hover:bg-purple-500 shadow-purple-600/20"
                />
                <div className="flex flex-wrap gap-2">
                  {editLeaderRoles.map((id) => (
                    <RoleTag
                      key={id}
                      roleId={id}
                      roles={roles}
                      onRemove={() =>
                        setEditLeaderRoles((prev) => prev.filter((r) => r !== id))
                      }
                      accentClass="bg-purple-600/10 border-purple-500/30 text-purple-300"
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleEditSave}
                  disabled={isSavingEdit}
                  className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer"
                >
                  {isSavingEdit ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleEditCancel}
                  disabled={isSavingEdit}
                  className="h-9 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            /* ---- Read-only mode ---- */
            <>
              <div>
                <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Member Roles
                </p>
                <div className="flex flex-wrap gap-2">
                  {mapping.memberRoleIds.length === 0 ? (
                    <span className="text-xs text-slate-600 italic">None</span>
                  ) : (
                    mapping.memberRoleIds.map((id) => {
                      const role = roles.find((r) => r.id === id);
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-2 py-1 px-3 rounded-xl bg-blue-600/10 border border-blue-500/30 text-blue-300 text-xs font-mono"
                        >
                          {role && (
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: roleColor(role.color) }}
                            />
                          )}
                          {role ? `@${role.name}` : id}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Leader Roles
                </p>
                <div className="flex flex-wrap gap-2">
                  {mapping.leaderRoleIds.length === 0 ? (
                    <span className="text-xs text-slate-600 italic">None</span>
                  ) : (
                    mapping.leaderRoleIds.map((id) => {
                      const role = roles.find((r) => r.id === id);
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-2 py-1 px-3 rounded-xl bg-purple-600/10 border border-purple-500/30 text-purple-300 text-xs font-mono"
                        >
                          {role && (
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: roleColor(role.color) }}
                            />
                          )}
                          {role ? `@${role.name}` : id}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const MAPPINGS_PER_PAGE = 5;

/** Compact pagination bar for the faction mapping list. */
function PaginationControls({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div className="flex items-center justify-between pt-2">
      <p className="text-[11px] font-mono text-slate-500">
        Page {currentPage} of {totalPages}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-400 transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={`w-8 h-8 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
              p === currentPage
                ? "bg-blue-600 text-white"
                : "bg-slate-800 hover:bg-slate-700 text-slate-400"
            }`}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-400 transition-colors cursor-pointer"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------

export function VerificationForm({
  guildId,
  initialConfig,
  roles,
  channels,
}: VerificationFormProps) {
  // --- General settings state ---
  const [verifiedRoleIds, setVerifiedRoleIds] = useState<string[]>(
    initialConfig.verifiedRoleIds,
  );
  const [nicknameTemplate, setNicknameTemplate] = useState(
    initialConfig.nicknameTemplate ?? "",
  );
  const [verifyOnJoin, setVerifyOnJoin] = useState(initialConfig.verifyOnJoin);
  const [verifyCron, setVerifyCron] = useState(initialConfig.verifyCron);
  // Stored as string so user can fully clear the field; validated to number on save
  const [verifyCronInterval, setVerifyCronInterval] = useState(
    String(initialConfig.verifyCronInterval),
  );
  const [protectedRoleIds, setProtectedRoleIds] = useState<string[]>(
    initialConfig.protectedRoleIds,
  );
  const [factionListChannelId, setFactionListChannelId] = useState(
    initialConfig.factionListChannelId ?? "",
  );

  // --- Faction mapping state ---
  const [mappings, setMappings] = useState<FactionMapping[]>(
    initialConfig.factionRoleMappings,
  );
  /** Mappings staged for addition — committed on Save. */
  const [pendingMappingAdds, setPendingMappingAdds] = useState<PendingMapping[]>([]);
  /** IDs of existing mappings staged for deletion — committed on Save. */
  const [pendingMappingDeletes, setPendingMappingDeletes] = useState<Set<string>>(new Set());
  /** Current pagination page for the faction mapping list. */
  const [mappingPage, setMappingPage] = useState(1);
  const [newFactionId, setNewFactionId] = useState("");
  const [resolvedFaction, setResolvedFaction] = useState<{
    id: number;
    name: string;
    tag: string | null;
  } | null>(null);
  const [isResolvingFaction, setIsResolvingFaction] = useState(false);
  const [newMemberRoles, setNewMemberRoles] = useState<string[]>([]);
  const [newLeaderRoles, setNewLeaderRoles] = useState<string[]>([]);

  /**
   * Manually triggered faction lookup — called by the Lookup button.
   */
  const handleLookupFaction = async () => {
    const factionIdNum = parseInt(newFactionId, 10);
    if (!newFactionId || isNaN(factionIdNum) || factionIdNum <= 0) {
      setResolvedFaction(null);
      return;
    }
    setIsResolvingFaction(true);
    try {
      const faction = await lookupFaction(factionIdNum);
      setResolvedFaction(faction);
      if (!faction) toast.error("Faction not found.");
    } finally {
      setIsResolvingFaction(false);
    }
  };

  // --- Save state ---
  const [isSaving, startSaving] = useTransition();

  // --- Dirty detection ---
  const isDirty =
    JSON.stringify(verifiedRoleIds) !==
    JSON.stringify(initialConfig.verifiedRoleIds) ||
    nicknameTemplate !== (initialConfig.nicknameTemplate ?? "") ||
    verifyOnJoin !== initialConfig.verifyOnJoin ||
    verifyCron !== initialConfig.verifyCron ||
    verifyCronInterval !== String(initialConfig.verifyCronInterval) ||
    JSON.stringify(protectedRoleIds) !==
    JSON.stringify(initialConfig.protectedRoleIds) ||
    factionListChannelId !== (initialConfig.factionListChannelId ?? "") ||
    pendingMappingAdds.length > 0 ||
    pendingMappingDeletes.size > 0;

  const handleDiscard = () => {
    setVerifiedRoleIds(initialConfig.verifiedRoleIds);
    setNicknameTemplate(initialConfig.nicknameTemplate ?? "");
    setVerifyOnJoin(initialConfig.verifyOnJoin);
    setVerifyCron(initialConfig.verifyCron);
    setVerifyCronInterval(String(initialConfig.verifyCronInterval));
    setProtectedRoleIds(initialConfig.protectedRoleIds);
    setFactionListChannelId(initialConfig.factionListChannelId ?? "");
    // Revert staged mapping changes
    setPendingMappingAdds([]);
    setPendingMappingDeletes(new Set());
    toast.info("Unsaved changes discarded.");
  };

  const handleSave = () => {
    // Validate cron interval before sending
    if (verifyCron) {
      const cronNum = parseInt(verifyCronInterval, 10);
      if (!verifyCronInterval || isNaN(cronNum) || cronNum < 1) {
        toast.error("Cron frequency must be a number of at least 1 hour.");
        return;
      }
    }

    // Snapshot pending state before async work to avoid stale closures
    const deletesToProcess = new Set(pendingMappingDeletes);
    const addsToProcess = [...pendingMappingAdds];

    startSaving(async () => {
      const cronNum = parseInt(verifyCronInterval, 10);

      // 1. Save core settings
      const settingsRes = await updateVerificationSettings(guildId, {
        verifiedRoleIds,
        nicknameTemplate: nicknameTemplate || null,
        verifyOnJoin,
        verifyCron,
        verifyCronInterval: isNaN(cronNum) ? initialConfig.verifyCronInterval : cronNum,
        protectedRoleIds,
        factionListChannelId: factionListChannelId || null,
      });

      if (!settingsRes.success) {
        toast.error(settingsRes.error || "Failed to save settings.");
        return;
      }

      // 2. Process pending deletes
      const confirmedDeletes = new Set<string>();
      for (const id of deletesToProcess) {
        const mapping = mappings.find((m) => m.id === id);
        const res = await deleteFactionRoleMapping(
          guildId,
          id,
          mapping?.factionId ?? 0,
          mapping?.factionName ?? null,
        );
        if (res.success) confirmedDeletes.add(id);
      }

      // 3. Process pending adds
      const confirmedAdds: FactionMapping[] = [];
      const failedAdds: PendingMapping[] = [];
      for (const pending of addsToProcess) {
        const res = await addFactionRoleMapping(guildId, {
          factionId: pending.factionId,
          factionName: pending.factionName || undefined,
          memberRoleIds: pending.memberRoleIds,
          leaderRoleIds: pending.leaderRoleIds,
        });
        if (res.success && res.mapping) {
          confirmedAdds.push(res.mapping as FactionMapping);
        } else {
          failedAdds.push(pending);
        }
      }

      // 4. Commit state updates
      setMappings((prev) => [
        ...prev.filter((m) => !confirmedDeletes.has(m.id)),
        ...confirmedAdds,
      ]);
      setPendingMappingDeletes((prev) => {
        const next = new Set(prev);
        confirmedDeletes.forEach((id) => next.delete(id));
        return next;
      });
      setPendingMappingAdds(failedAdds);

      const hadErrors =
        failedAdds.length > 0 ||
        confirmedDeletes.size < deletesToProcess.size;

      if (hadErrors) {
        toast.warning("Settings saved, but some mapping changes failed.");
      } else {
        toast.success("Verification settings saved.");
      }
    });
  };

  /** Stages a new faction mapping — committed to DB only on Save Changes. */
  const handleAddMapping = () => {
    const factionIdNum = parseInt(newFactionId, 10);
    if (!newFactionId || isNaN(factionIdNum) || factionIdNum <= 0) {
      toast.error("Enter a valid numeric Faction ID.");
      return;
    }
    if (
      mappings.some((m) => m.factionId === factionIdNum) ||
      pendingMappingAdds.some((m) => m.factionId === factionIdNum)
    ) {
      toast.warning("A mapping for this faction already exists.");
      return;
    }

    const pending: PendingMapping = {
      tempId: `pending-${factionIdNum}-${Date.now()}`,
      factionId: factionIdNum,
      factionName: resolvedFaction?.name ?? null,
      memberRoleIds: newMemberRoles,
      leaderRoleIds: newLeaderRoles,
    };
    setPendingMappingAdds((prev) => [...prev, pending]);
    setNewFactionId("");
    setResolvedFaction(null);
    setNewMemberRoles([]);
    setNewLeaderRoles([]);
  };

  const textInputClass =
    "w-full max-w-md h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-mono focus:outline-none focus:border-blue-500/50 transition-colors";

  const sectionClass =
    "p-6 lg:p-8 rounded-3xl bg-[#0c111d] border border-slate-800/80 space-y-6 shadow-xl relative overflow-hidden";

  const sectionHeaderClass =
    "flex items-center gap-3.5 pb-4 border-b border-slate-800/80";

  const labelClass =
    "block text-xs font-mono font-semibold uppercase tracking-wider text-slate-400";

  return (
    <div className="space-y-8 pb-12">
      {/* ---------------------------------------------------------------- */}
      {/* 1. Verified Member Roles */}
      {/* ---------------------------------------------------------------- */}
      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              Verified Member Roles
            </h2>
          </div>
        </div>

        <div className="space-y-4">
          <label className={labelClass}>Roles assigned on successful verification</label>
          <RoleAdder
            roles={roles}
            selected={verifiedRoleIds}
            onAdd={(id) => setVerifiedRoleIds((prev) => [...prev, id])}
            placeholder="-- Select Role to Add --"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {verifiedRoleIds.length === 0 ? (
              <div className="p-3.5 rounded-2xl bg-slate-900/50 border border-slate-800/60 text-xs text-slate-500 italic w-full">
                No verified roles assigned.
              </div>
            ) : (
              verifiedRoleIds.map((id) => (
                <RoleTag
                  key={id}
                  roleId={id}
                  roles={roles}
                  onRemove={() =>
                    setVerifiedRoleIds((prev) => prev.filter((r) => r !== id))
                  }
                />
              ))
            )}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* 2. Nickname Template */}
      {/* ---------------------------------------------------------------- */}
      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              Nickname Template
            </h2>
          </div>
        </div>

        <div className="space-y-3">
          <label className={labelClass}>
            Template string
          </label>
          <input
            type="text"
            value={nicknameTemplate}
            onChange={(e) => setNicknameTemplate(e.target.value)}
            placeholder="[{tag}] {name} [{id}]"
            className={textInputClass}
          />
          <p className="text-[11px] text-slate-500 font-mono">
            Variables: <span className="text-slate-400">{"{name}"}</span>,{" "}
            <span className="text-slate-400">{"{id}"}</span>,{" "}
            <span className="text-slate-400">{"{tag}"}</span>
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* 3. Behaviour Toggles */}
      {/* ---------------------------------------------------------------- */}
      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              Verification Behaviour
            </h2>
          </div>
        </div>

        <div className="space-y-3">
          <Toggle
            checked={verifyOnJoin}
            onChange={setVerifyOnJoin}
            label="Verify on Join"
            description="Automatically verify members when they join the server."
          />
          <Toggle
            checked={verifyCron}
            onChange={setVerifyCron}
            label="Background Cron Verification"
            description="Periodically re-verify all members to keep roles in sync."
          />
        </div>

        {verifyCron && (
          <div className="space-y-3 pt-2">
            <label className={labelClass}>Cron Frequency (hours)</label>
            <div className="flex items-center gap-3 max-w-xs">
              <input
                type="number"
                min={1}
                max={168}
                value={verifyCronInterval}
                onChange={(e) => setVerifyCronInterval(e.target.value)}
                placeholder="24"
                className="w-28 h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-mono focus:outline-none focus:border-blue-500/50 transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="text-xs text-slate-500 font-mono">
                hours between sweeps
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* 4. Protected Roles (Watched against faction map) */}
      {/* ---------------------------------------------------------------- */}
      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              Protected Roles
            </h2>
          </div>
        </div>

        <div className="space-y-4">
          <label className={labelClass}>
            Roles watched against the faction map
          </label>
          <RoleAdder
            roles={roles}
            selected={protectedRoleIds}
            onAdd={(id) => setProtectedRoleIds((prev) => [...prev, id])}
            placeholder="-- Select Protected Role --"
            accentFocus="focus:border-amber-500/50"
            buttonClass="bg-amber-600 hover:bg-amber-500 shadow-amber-600/20"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {protectedRoleIds.length === 0 ? (
              <div className="p-3.5 rounded-2xl bg-slate-900/50 border border-slate-800/60 text-xs text-slate-500 italic w-full">
                No protected roles configured.
              </div>
            ) : (
              protectedRoleIds.map((id) => (
                <RoleTag
                  key={id}
                  roleId={id}
                  roles={roles}
                  onRemove={() =>
                    setProtectedRoleIds((prev) => prev.filter((r) => r !== id))
                  }
                  accentClass="bg-amber-600/10 border-amber-500/30 text-amber-300"
                />
              ))
            )}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* 5. Faction List Log Channel */}
      {/* ---------------------------------------------------------------- */}
      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              Faction List Channel
            </h2>
          </div>
        </div>

        <div className="space-y-3 flex flex-col">
          <label className={labelClass}>Channel to post faction names</label>

          {channels.length > 0 ? (
            <select
              value={factionListChannelId}
              onChange={(e) => setFactionListChannelId(e.target.value)}
              className="w-full max-w-md h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-sans focus:outline-none focus:border-blue-500/50 transition-colors cursor-pointer"
            >
              <option value="">-- No Channel Selected --</option>
              {channels
                .filter((c) => c.type === 0)
                .map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
            </select>
          ) : (
            <input
              type="text"
              value={factionListChannelId}
              onChange={(e) => setFactionListChannelId(e.target.value)}
              placeholder="Enter Discord Channel ID"
              className={textInputClass}
            />
          )}

          {factionListChannelId && (
            <div className="mt-1 w-fit inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 font-mono">
              <span className="text-slate-500">SELECTED:</span>
              <span className="text-blue-400 font-bold">
                {channels.find((c) => c.id === factionListChannelId)?.name ||
                  factionListChannelId}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* 6. Faction Role Mappings */}
      {/* ---------------------------------------------------------------- */}
      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              Faction Role Mappings
            </h2>
          </div>
        </div>

        {/* Add new mapping form */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-5">
          <p className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400">
            Add Mapping
          </p>

          <div className="space-y-2">
            <label className={labelClass}>Faction ID</label>
            <div className="flex gap-2.5">
              <input
                type="number"
                value={newFactionId}
                onChange={(e) => {
                  setNewFactionId(e.target.value);
                  setResolvedFaction(null);
                }}
                placeholder="e.g. 8795"
                className="w-36 h-11 py-2.5 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-sm font-mono focus:outline-none focus:border-blue-500/50 transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={handleLookupFaction}
                disabled={isResolvingFaction || !newFactionId}
                className="h-11 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer shrink-0 border border-slate-700"
              >
                {isResolvingFaction ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : null}
                Lookup
              </button>
              {/* Resolved faction name display */}
              {resolvedFaction && (
                <div className="h-11 px-3.5 rounded-xl bg-slate-900/50 border border-slate-800/60 flex items-center text-sm font-mono flex-1 min-w-0">
                  <span className="text-white truncate">
                    {resolvedFaction.name}
                    {resolvedFaction.tag && (
                      <span className="ml-2 text-slate-400 text-xs">
                        [{resolvedFaction.tag}]
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>


          <div className="space-y-2">
            <label className={labelClass}>Member Roles</label>
            <RoleAdder
              roles={roles}
              selected={newMemberRoles}
              onAdd={(id) => setNewMemberRoles((prev) => [...prev, id])}
              placeholder="-- Select Member Role --"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {newMemberRoles.map((id) => (
                <RoleTag
                  key={id}
                  roleId={id}
                  roles={roles}
                  onRemove={() =>
                    setNewMemberRoles((prev) => prev.filter((r) => r !== id))
                  }
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className={labelClass}>Leader Roles</label>
            <RoleAdder
              roles={roles}
              selected={newLeaderRoles}
              onAdd={(id) => setNewLeaderRoles((prev) => [...prev, id])}
              placeholder="-- Select Leader Role --"
              accentFocus="focus:border-purple-500/50"
              buttonClass="bg-purple-600 hover:bg-purple-500 shadow-purple-600/20"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {newLeaderRoles.map((id) => (
                <RoleTag
                  key={id}
                  roleId={id}
                  roles={roles}
                  onRemove={() =>
                    setNewLeaderRoles((prev) => prev.filter((r) => r !== id))
                  }
                  accentClass="bg-purple-600/10 border-purple-500/30 text-purple-300"
                />
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleAddMapping}
            className="h-11 py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-emerald-600/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Stage Mapping
          </button>
        </div>

        {/* Mappings list — existing + pending adds, paginated */}
        {(() => {
          // Combine saved mappings and pending adds into one unified list for pagination
          type ListItem =
            | { kind: "saved"; mapping: FactionMapping }
            | { kind: "pending"; pending: PendingMapping };

          const allItems: ListItem[] = [
            ...mappings.map((m) => ({ kind: "saved" as const, mapping: m })),
            ...pendingMappingAdds.map((p) => ({ kind: "pending" as const, pending: p })),
          ];

          const totalPages = Math.max(1, Math.ceil(allItems.length / MAPPINGS_PER_PAGE));
          const safePage = Math.min(mappingPage, totalPages);
          const pageItems = allItems.slice(
            (safePage - 1) * MAPPINGS_PER_PAGE,
            safePage * MAPPINGS_PER_PAGE,
          );

          if (allItems.length === 0) {
            return (
              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/60 text-xs text-slate-500 text-center italic">
                No faction role mappings configured.
              </div>
            );
          }

          return (
            <div className="space-y-3">
              {/* Count badge */}
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-mono text-slate-500">
                  {allItems.length} mapping{allItems.length !== 1 ? "s" : ""} total
                </p>
              </div>

              {/* Page items */}
              {pageItems.map((item) => {
                if (item.kind === "saved") {
                  const { mapping } = item;
                  return (
                    <FactionMappingCard
                      key={mapping.id}
                      mapping={mapping}
                      roles={roles}
                      guildId={guildId}
                      isPendingDelete={pendingMappingDeletes.has(mapping.id)}
                      onToggleDelete={() =>
                        setPendingMappingDeletes((prev) => {
                          const next = new Set(prev);
                          if (next.has(mapping.id)) next.delete(mapping.id);
                          else next.add(mapping.id);
                          return next;
                        })
                      }
                      onUpdated={(updated) =>
                        setMappings((prev) =>
                          prev.map((m) => (m.id === updated.id ? updated : m))
                        )
                      }
                    />
                  );
                }

                const { pending } = item;
                return (
                  <div
                    key={pending.tempId}
                    className="rounded-2xl bg-amber-950/30 border border-amber-500/30 overflow-hidden"
                  >
                    <div className="p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="shrink-0 w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                          <span className="text-[10px] font-mono font-bold text-slate-400">
                            {pending.factionId}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-white truncate">
                              {pending.factionName || `Faction #${pending.factionId}`}
                            </p>
                            <span className="shrink-0 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-mono font-bold">
                              UNSAVED
                            </span>
                          </div>
                          <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                            {pending.memberRoleIds.length} member{" "}
                            {pending.memberRoleIds.length !== 1 ? "roles" : "role"} ·{" "}
                            {pending.leaderRoleIds.length} leader{" "}
                            {pending.leaderRoleIds.length !== 1 ? "roles" : "role"}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingMappingAdds((prev) =>
                            prev.filter((m) => m.tempId !== pending.tempId)
                          )
                        }
                        className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 transition-all cursor-pointer shrink-0"
                        title="Remove staged mapping"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}

              <PaginationControls
                currentPage={safePage}
                totalPages={totalPages}
                onPageChange={setMappingPage}
              />
            </div>
          );
        })()}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Unified Save / Discard Footer */}
      {/* ---------------------------------------------------------------- */}
      <div className="pt-6 border-t border-slate-800/80 flex items-center justify-between gap-4">
        <div className="text-xs text-slate-400 font-mono">
          {isDirty ? (
            <span className="text-amber-400 flex items-center gap-2 font-semibold">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Unsaved changes pending
            </span>
          ) : (
            <span className="text-slate-500">All settings saved</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {isDirty && (
            <button
              type="button"
              onClick={handleDiscard}
              disabled={isSaving}
              className="h-11 py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            className="h-11 py-2.5 px-6 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-blue-600/25 cursor-pointer"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
