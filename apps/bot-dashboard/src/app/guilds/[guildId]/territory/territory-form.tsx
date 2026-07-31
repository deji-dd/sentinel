"use client";

import React, { useState, useEffect, useTransition } from "react";
import { updateTerritorySettings, lookupFaction } from "@/actions/guilds";
import { Save, Plus, X, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface TerritoryFormProps {
  guildId: string;
  initialConfig: {
    ttFullChannelId: string | null;
    ttFilteredChannelId: string | null;
    ttTerritoryIds: string[];
    ttFactionIds: number[];
  };
  channels: { id: string; name: string; type: number }[];
  territories?: { id: string; sector?: number }[];
}

export function TerritoryForm({
  guildId,
  initialConfig,
  channels,
  territories = [],
}: TerritoryFormProps) {
  const [ttFullChannelId, setTtFullChannelId] = useState<string | null>(
    initialConfig.ttFullChannelId,
  );
  const [ttFilteredChannelId, setTtFilteredChannelId] = useState<string | null>(
    initialConfig.ttFilteredChannelId,
  );
  const [ttTerritoryIds, setTtTerritoryIds] = useState<string[]>(
    initialConfig.ttTerritoryIds,
  );
  const [ttFactionIds, setTtFactionIds] = useState<number[]>(
    initialConfig.ttFactionIds,
  );

  // Input states
  const [newTerritoryInput, setNewTerritoryInput] = useState("");
  const [newFactionInput, setNewFactionInput] = useState("");

  // Faction lookup state
  const [isResolvingFaction, setIsResolvingFaction] = useState(false);
  const [factionNamesMap, setFactionNamesMap] = useState<
    Record<number, { name: string; tag: string | null }>
  >({});


  const [isSaving, startSaving] = useTransition();

  // Text channels filter (type === 0 or type === 5 for announcement channels)
  const textChannels = channels.filter(
    (c) => c.type === 0 || c.type === 5,
  );

  // Resolve names for initial faction IDs on mount
  useEffect(() => {
    initialConfig.ttFactionIds.forEach(async (id) => {
      try {
        const faction = await lookupFaction(id);
        if (faction) {
          setFactionNamesMap((prev) => ({
            ...prev,
            [id]: { name: faction.name, tag: faction.tag },
          }));
        }
      } catch {
        // Ignore lookup error
      }
    });
  }, [initialConfig.ttFactionIds]);

  // Available territories for dropdown
  const availableTerritories = territories.filter(
    (t) => !ttTerritoryIds.includes(t.id),
  );

  // Dirty detection
  const isDirty =
    ttFullChannelId !== (initialConfig.ttFullChannelId ?? null) ||
    ttFilteredChannelId !== (initialConfig.ttFilteredChannelId ?? null) ||
    JSON.stringify(ttTerritoryIds) !== JSON.stringify(initialConfig.ttTerritoryIds) ||
    JSON.stringify(ttFactionIds) !== JSON.stringify(initialConfig.ttFactionIds);

  const handleDiscard = () => {
    setTtFullChannelId(initialConfig.ttFullChannelId ?? null);
    setTtFilteredChannelId(initialConfig.ttFilteredChannelId ?? null);
    setTtTerritoryIds(initialConfig.ttTerritoryIds);
    setTtFactionIds(initialConfig.ttFactionIds);
    setNewTerritoryInput("");
    setNewFactionInput("");
    toast.info("Unsaved changes discarded.");
  };


  const handleAddTerritory = () => {
    const trimmed = newTerritoryInput.trim().toUpperCase();
    if (!trimmed) return;
    if (ttTerritoryIds.includes(trimmed)) {
      toast.warning(`Territory "${trimmed}" is already added.`);
      return;
    }
    setTtTerritoryIds([...ttTerritoryIds, trimmed]);
    setNewTerritoryInput("");
  };

  const handleRemoveTerritory = (id: string) => {
    setTtTerritoryIds(ttTerritoryIds.filter((t) => t !== id));
  };

  const handleAddFaction = async () => {
    const parsed = parseInt(newFactionInput.trim(), 10);
    if (isNaN(parsed) || parsed <= 0) {
      toast.error("Please enter a valid positive numeric Faction ID.");
      return;
    }
    if (ttFactionIds.includes(parsed)) {
      toast.warning(`Faction ID ${parsed} is already added.`);
      return;
    }

    setIsResolvingFaction(true);
    try {
      const faction = await lookupFaction(parsed);
      if (!faction) {
        toast.error(`Faction ID ${parsed} not found.`);
        return;
      }

      setFactionNamesMap((prev) => ({
        ...prev,
        [parsed]: { name: faction.name, tag: faction.tag },
      }));
      setTtFactionIds((prev) => [...prev, parsed]);
      setNewFactionInput("");
    } catch {
      toast.error(`Failed to verify Faction ID ${parsed}.`);
    } finally {
      setIsResolvingFaction(false);
    }
  };

  const handleRemoveFaction = (id: number) => {
    setTtFactionIds(ttFactionIds.filter((f) => f !== id));
  };


  const handleSave = () => {
    startSaving(async () => {
      try {
        const res = await updateTerritorySettings(guildId, {
          ttFullChannelId: ttFullChannelId || null,
          ttFilteredChannelId: ttFilteredChannelId || null,
          ttTerritoryIds,
          ttFactionIds,
        });

        if (res.success) {
          toast.success("Territory alert settings updated successfully!");
        } else {
          toast.error(res.error || "Failed to update territory settings.");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "An unexpected error occurred.",
        );
      }
    });
  };

  const sectionClass =
    "p-6 lg:p-8 rounded-3xl bg-[#0c111d] border border-slate-800/80 space-y-6 shadow-xl relative overflow-hidden";

  const sectionHeaderClass =
    "flex items-center gap-3.5 pb-4 border-b border-slate-800/80";

  const labelClass =
    "block text-xs font-mono font-semibold uppercase tracking-wider text-slate-400";

  return (
    <div className="space-y-8 pb-12">
      {/* 1. Full Territory Feed Channel */}
      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              Full Territory Feed Channel
            </h2>
          </div>
        </div>

        <div className="space-y-3 flex flex-col">
          <label className={labelClass}>Target Discord Channel</label>
          <select
            value={ttFullChannelId || ""}
            onChange={(e) => setTtFullChannelId(e.target.value || null)}
            className="w-full max-w-md h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-sans focus:outline-none focus:border-blue-500/50 transition-colors cursor-pointer"
          >
            <option value="">-- No Channel Selected --</option>
            {textChannels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {ttFullChannelId && (
            <div className="mt-1 w-fit inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 font-mono">
              <span className="text-slate-500">SELECTED:</span>
              <span className="text-blue-400 font-bold">
                {textChannels.find((c) => c.id === ttFullChannelId)?.name ||
                  ttFullChannelId}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* 2. Filtered Territory Feed Channel */}
      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              Filtered Feed Channel
            </h2>
          </div>
        </div>

        <div className="space-y-3 flex flex-col">
          <label className={labelClass}>Target Discord Channel</label>
          <select
            value={ttFilteredChannelId || ""}
            onChange={(e) => setTtFilteredChannelId(e.target.value || null)}
            className="w-full max-w-md h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-sans focus:outline-none focus:border-blue-500/50 transition-colors cursor-pointer"
          >
            <option value="">-- No Channel Selected --</option>
            {textChannels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {ttFilteredChannelId && (
            <div className="mt-1 w-fit inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 font-mono">
              <span className="text-slate-500">SELECTED:</span>
              <span className="text-blue-400 font-bold">
                {textChannels.find((c) => c.id === ttFilteredChannelId)?.name ||
                  ttFilteredChannelId}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* 3. Target Territory Codes */}
      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              Target Territory Codes
            </h2>
          </div>
        </div>

        <div className="space-y-4">
          <label className={labelClass}>Territory Codes</label>
          <div className="flex gap-2.5 max-w-md">
            {territories.length > 0 ? (
              <select
                value={newTerritoryInput}
                onChange={(e) => setNewTerritoryInput(e.target.value)}
                className="flex-1 h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-mono focus:outline-none focus:border-blue-500/50 transition-colors cursor-pointer"
              >
                <option value="">-- Select Territory Code --</option>
                {availableTerritories.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id} {t.sector ? `(Sector ${t.sector})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={newTerritoryInput}
                onChange={(e) => setNewTerritoryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTerritory();
                  }
                }}
                placeholder="e.g. BBB"
                className="flex-1 h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-mono focus:outline-none focus:border-blue-500/50 transition-colors uppercase"
              />
            )}
            <button
              type="button"
              onClick={handleAddTerritory}
              className="h-11 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-blue-600/20 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {ttTerritoryIds.length === 0 ? (
              <div className="p-3.5 rounded-2xl bg-slate-900/50 border border-slate-800/60 text-xs text-slate-500 italic w-full">
                No territory codes configured.
              </div>
            ) : (
              ttTerritoryIds.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-2 py-1.5 px-3.5 rounded-xl border text-xs font-medium font-mono bg-blue-600/10 border-blue-500/30 text-blue-300"
                >
                  <span>{id}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTerritory(id)}
                    className="p-0.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                    title="Remove"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
      </section>

      {/* 4. Target Faction IDs */}
      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              Target Faction IDs
            </h2>
          </div>
        </div>

        <div className="space-y-4">
          <label className={labelClass}>Faction IDs</label>
          <div className="flex gap-2.5 max-w-md">
            <input
              type="number"
              value={newFactionInput}
              onChange={(e) => setNewFactionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddFaction();
                }
              }}
              placeholder="e.g. 8807"
              className="flex-1 h-11 py-2.5 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-sm font-mono focus:outline-none focus:border-purple-500/50 transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              type="button"
              onClick={handleAddFaction}
              disabled={isResolvingFaction || !newFactionInput.trim()}
              className="h-11 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-purple-600/20 cursor-pointer shrink-0"
            >
              {isResolvingFaction ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Add
            </button>
          </div>


          <div className="flex flex-wrap gap-2 pt-1">
            {ttFactionIds.length === 0 ? (
              <div className="p-3.5 rounded-2xl bg-slate-900/50 border border-slate-800/60 text-xs text-slate-500 italic w-full">
                No faction IDs configured.
              </div>
            ) : (
              ttFactionIds.map((id) => {
                const meta = factionNamesMap[id];
                const displayName = meta
                  ? `${meta.name}${meta.tag ? ` [${meta.tag}]` : ""} (${id})`
                  : `Faction ${id}`;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-2 py-1.5 px-3.5 rounded-xl border text-xs font-medium font-mono bg-purple-600/10 border-purple-500/30 text-purple-300"
                  >
                    <span>{displayName}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFaction(id)}
                      className="p-0.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                      title="Remove"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* Unified Save / Discard Footer */}
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
