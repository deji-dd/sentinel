"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, Plus, X, MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getTerritoryList, getFactionInfo } from "@/actions/guilds";
import type { FactionRoleMappingDocument, TerritoryBlueprintSummary } from "@sentinel/shared";

interface TerritoryTabProps {
  guildId: string;
  ttFullChannelInput: string;
  setTtFullChannelInput: (val: string) => void;
  ttFilteredChannelInput: string;
  setTtFilteredChannelInput: (val: string) => void;
  ttTerritoryIdsInput: string[];
  setTtTerritoryIdsInput: (val: string[]) => void;
  ttFactionIdsInput: number[];
  setTtFactionIdsInput: (val: number[]) => void;
  channels: { id: string; name: string; type: number }[];
  factionMappings: FactionRoleMappingDocument[];
}

/** Resolved faction info stored alongside watched IDs for display purposes. */
interface ResolvedFaction {
  id: number;
  name: string;
}

/**
 * Territory tab subview for configuring full & filtered channels, DB watched territories, and watched factions.
 */
export function TerritoryTab({
  guildId,
  ttFullChannelInput,
  setTtFullChannelInput,
  ttFilteredChannelInput,
  setTtFilteredChannelInput,
  ttTerritoryIdsInput,
  setTtTerritoryIdsInput,
  ttFactionIdsInput,
  setTtFactionIdsInput,
  channels,
  factionMappings,
}: TerritoryTabProps) {
  const [dbTerritories, setDbTerritories] = useState<TerritoryBlueprintSummary[]>([]);
  const [loadingTerritories, setLoadingTerritories] = useState<boolean>(false);
  const [manualCodeInput, setManualCodeInput] = useState<string>("");
  const [manualCodeError, setManualCodeError] = useState<string>("");

  const [newFactionIdInput, setNewFactionIdInput] = useState<string>("");
  const [verifyingFaction, setVerifyingFaction] = useState<boolean>(false);
  const [resolvedFactions, setResolvedFactions] = useState<Map<number, ResolvedFaction>>(new Map());

  useEffect(() => {
    async function loadTerritories() {
      setLoadingTerritories(true);
      try {
        const res = await getTerritoryList();
        if (res.success && res.territories) {
          setDbTerritories(res.territories);
        }
      } catch (err) {
        console.error("Failed to fetch DB territories:", err);
      } finally {
        setLoadingTerritories(false);
      }
    }
    loadTerritories();
  }, []);

  // Resolve names for any pre-existing watched faction IDs that aren't already in factionMappings
  useEffect(() => {
    const unresolved = ttFactionIdsInput.filter(
      (id) => !factionMappings.find((m) => m.faction_id === id) && !resolvedFactions.has(id)
    );
    if (unresolved.length === 0) return;

    unresolved.forEach(async (id) => {
      try {
        const res = await getFactionInfo(guildId, id);
        if (res.success && res.faction?.name) {
          setResolvedFactions((prev) => new Map(prev).set(id, { id, name: res.faction.name }));
        }
      } catch {
        // Non-fatal — we just won't have a name
      }
    });
  }, [ttFactionIdsInput, factionMappings, guildId, resolvedFactions]);

  /**
   * Validates manual territory code input against the DB blueprint list before adding.
   */
  const handleAddManualTerritory = () => {
    const code = manualCodeInput.trim().toUpperCase();
    if (!code) return;

    if (dbTerritories.length > 0) {
      const exists = dbTerritories.some((t) => t.id === code);
      if (!exists) {
        setManualCodeError(`"${code}" is not a known territory code. Select from the dropdown.`);
        return;
      }
    }

    if (!ttTerritoryIdsInput.includes(code)) {
      setTtTerritoryIdsInput([...ttTerritoryIdsInput, code]);
    } else {
      toast.info(`${code} is already being watched.`);
    }
    setManualCodeInput("");
    setManualCodeError("");
  };

  /**
   * Adds a territory from the DB dropdown — always valid.
   */
  const handleAddDropdownTerritory = (code: string) => {
    if (!code) return;
    if (!ttTerritoryIdsInput.includes(code)) {
      setTtTerritoryIdsInput([...ttTerritoryIdsInput, code]);
    }
  };

  const handleRemoveWatchedTerritory = (code: string) => {
    setTtTerritoryIdsInput(ttTerritoryIdsInput.filter((c) => c !== code));
  };

  /**
   * Verifies a faction ID via API before adding it to the watch list.
   */
  const handleAddWatchedFaction = async () => {
    const num = Number(newFactionIdInput.trim());
    if (isNaN(num) || num <= 0) {
      toast.error("Please enter a valid numeric Faction ID.");
      return;
    }
    if (ttFactionIdsInput.includes(num)) {
      toast.info(`Faction ${num} is already being watched.`);
      setNewFactionIdInput("");
      return;
    }

    setVerifyingFaction(true);
    try {
      const res = await getFactionInfo(guildId, num);
      if (!res.success || !res.faction?.name) {
        toast.error(`Faction ID ${num} not found or invalid.`);
        return;
      }

      setTtFactionIdsInput([...ttFactionIdsInput, num]);
      setResolvedFactions((prev) => new Map(prev).set(num, { id: num, name: res.faction.name }));
      toast.success(`Added faction: ${res.faction.name} (${num})`);
      setNewFactionIdInput("");
    } catch {
      toast.error("Failed to verify faction. Check ID and try again.");
    } finally {
      setVerifyingFaction(false);
    }
  };

  const handleRemoveWatchedFaction = (factionId: number) => {
    setTtFactionIdsInput(ttFactionIdsInput.filter((f) => f !== factionId));
  };

  const getFactionDisplayName = (id: number): string => {
    const fromMapping = factionMappings.find((m) => m.faction_id === id);
    if (fromMapping?.faction_name) return `${fromMapping.faction_name} (${id})`;
    const resolved = resolvedFactions.get(id);
    if (resolved) return `${resolved.name} (${id})`;
    return `ID: ${id}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight">Territory</h2>
      </div>

      {/* Notification Channels Card */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-purple-500 shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            Notification Channels
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Full Channel */}
            <div className="space-y-2">
              <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Full Notifications Channel</label>
              <div className="relative">
                <select
                  value={ttFullChannelInput || ""}
                  onChange={(e) => setTtFullChannelInput(e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2.5 pl-3.5 pr-10 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="" className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">None (Disabled)</option>
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
              <p className="text-[10px] text-zinc-500">Receives raw notifications for all territory changes across Torn.</p>
            </div>

            {/* Filtered Channel */}
            <div className="space-y-2">
              <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Filtered Notifications Channel</label>
              <div className="relative">
                <select
                  value={ttFilteredChannelInput || ""}
                  onChange={(e) => setTtFilteredChannelInput(e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2.5 pl-3.5 pr-10 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="" className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">None (Disabled)</option>
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
              <p className="text-[10px] text-zinc-500">Only receives notifications involving your watched territories or watched factions.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Territories to Watch Card (DB Powered with 24h Cache) */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-blue-500 shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            Territories to Watch
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 max-w-xl">
            {/* DB Dropdown Selector — always valid */}
            <div className="relative flex-1">
              <select
                value=""
                onChange={(e) => {
                  handleAddDropdownTerritory(e.target.value);
                }}
                disabled={loadingTerritories}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2.5 pl-3.5 pr-10 text-xs font-mono text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
              >
                <option value="" className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 font-sans">
                  {loadingTerritories ? "Loading territory list from DB..." : "Select territory from Database..."}
                </option>
                {dbTerritories
                  .filter((t) => !ttTerritoryIdsInput.includes(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id} className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 font-mono">
                      {t.id} (Sector {t.sector} | Size {t.size} | Respect {t.respect})
                    </option>
                  ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 dark:text-zinc-400">
                <ChevronDown className="size-4" />
              </div>
            </div>

            {/* Manual Code Input — validated against DB list */}
            <div className="flex flex-col gap-1">
              <div className="flex gap-2">
                <Input
                  placeholder="Type code..."
                  value={manualCodeInput}
                  onChange={(e) => {
                    setManualCodeInput(e.target.value);
                    if (manualCodeError) setManualCodeError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddManualTerritory();
                    }
                  }}
                  className={`bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-zinc-800 dark:text-zinc-300 uppercase font-mono text-xs w-32 ${manualCodeError ? "border-red-400 dark:border-red-500" : ""}`}
                />
                <Button
                  type="button"
                  onClick={handleAddManualTerritory}
                  disabled={!manualCodeInput.trim()}
                  className="bg-zinc-900 dark:bg-white text-white dark:text-black font-bold px-3.5 cursor-pointer text-xs"
                >
                  <Plus className="size-3.5 mr-1" />
                  Add
                </Button>
              </div>
              {manualCodeError && (
                <p className="text-[10px] text-red-500 dark:text-red-400">{manualCodeError}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 min-h-12 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/20">
            {ttTerritoryIdsInput.length === 0 ? (
              <span className="text-xs text-zinc-400 dark:text-zinc-500 italic flex items-center">No specific territories watched yet. All territories will trigger full alerts.</span>
            ) : (
              ttTerritoryIdsInput.map((code) => {
                const dbInfo = dbTerritories.find((t) => t.id === code);
                return (
                  <Badge
                    key={code}
                    variant="secondary"
                    className="flex items-center gap-1.5 py-1 pl-2.5 pr-2 text-xs bg-purple-500/10 text-purple-600 dark:text-purple-300 border border-purple-500/20 font-mono shadow-xs"
                  >
                    <MapPin className="size-3 text-purple-500" />
                    {dbInfo ? `${code} (Sec ${dbInfo.sector})` : code}
                    <button
                      type="button"
                      onClick={() => handleRemoveWatchedTerritory(code)}
                      className="text-zinc-400 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 rounded-full p-0.5 leading-none transition-colors cursor-pointer"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Factions to Watch Card — verified via API before adding */}
      <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-indigo-500 shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg font-bold">
            Factions to Watch
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 max-w-md">
            <Input
              type="number"
              placeholder="Enter Faction ID (e.g. 8000)..."
              value={newFactionIdInput}
              onChange={(e) => setNewFactionIdInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddWatchedFaction();
                }
              }}
              disabled={verifyingFaction}
              className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-zinc-800 dark:text-zinc-300 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-xs"
            />
            <Button
              type="button"
              onClick={handleAddWatchedFaction}
              disabled={!newFactionIdInput.trim() || verifyingFaction}
              className="bg-zinc-900 dark:bg-white text-white dark:text-black font-bold px-4 cursor-pointer text-xs min-w-20"
            >
              {verifyingFaction ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <>
                  <Plus className="size-3.5 mr-1" />
                  Add
                </>
              )}
            </Button>
          </div>
          <p className="text-[10px] text-zinc-500">Faction ID will be verified against the Torn API before being added.</p>

          <div className="flex flex-wrap gap-2 min-h-12 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/20">
            {ttFactionIdsInput.length === 0 ? (
              <span className="text-xs text-zinc-400 dark:text-zinc-500 italic flex items-center">No specific factions watched yet.</span>
            ) : (
              ttFactionIdsInput.map((factionId) => (
                <Badge
                  key={factionId}
                  variant="secondary"
                  className="flex items-center gap-1.5 py-1 pl-2.5 pr-2 text-xs bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 font-mono shadow-xs"
                >
                  {getFactionDisplayName(factionId)}
                  <button
                    type="button"
                    onClick={() => handleRemoveWatchedFaction(factionId)}
                    className="text-zinc-400 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 rounded-full p-0.5 leading-none transition-colors cursor-pointer"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
