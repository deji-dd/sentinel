"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  Users,
  Map,
  Coins,
  Smile,
  ShieldCheck,
  Settings,
  ChevronRight,
  Menu,
  Save,
  RotateCcw,
  ArrowLeft,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "sonner";

import {
  updateGuildConfig,
  deinitializeGuild,
  addGuildApiKey,
  deleteGuildApiKey,
  setGuildApiKeyPrimary,
  getFactionRoleMappings,
  createFactionRoleMapping,
  updateFactionRoleMapping,
  deleteFactionRoleMapping,
  getFactionInfo,
} from "@/actions/guilds";

import type {
  GuildConfigDocument,
  SystemModuleDocument,
  MaskedGuildApiKey,
  FactionRoleMappingDocument,
} from "@sentinel/shared";

// Extracted Tab & Modal Subcomponents
import { VerificationTab } from "@/components/dashboard/tabs/verification-tab";
import { TerritoryTab } from "@/components/dashboard/tabs/territory-tab";
import { BazaarTab } from "@/components/dashboard/tabs/bazaar-tab";
import { ReactionsTab } from "@/components/dashboard/tabs/reactions-tab";
import { ModulesTab } from "@/components/dashboard/tabs/modules-tab";
import { SettingsTab } from "@/components/dashboard/tabs/settings-tab";
import { FactionMappingModal } from "@/components/dashboard/modals/faction-mapping-modal";
import { DeinitializeModal } from "@/components/dashboard/modals/deinitialize-modal";
import { DeleteConfirmModal } from "@/components/dashboard/modals/delete-confirm-modal";

export type TabType =
  | "settings"
  | "verification"
  | "territories"
  | "bazaar"
  | "reactions"
  | "modules";

interface MenuCategory {
  id: TabType;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  color: string;
  isModule: boolean;
  moduleId?: string;
  ownerOnly: boolean;
}

const baseMenuItems: MenuCategory[] = [
  { id: "settings", label: "Settings", icon: Settings, color: "text-slate-500", isModule: false, ownerOnly: false },
  { id: "verification", label: "Verification", icon: Users, color: "text-blue-500", isModule: true, moduleId: "verification", ownerOnly: false },
  { id: "territories", label: "Territory", icon: Map, color: "text-purple-500", isModule: true, moduleId: "territories", ownerOnly: false },
  { id: "bazaar", label: "Bazaar Alerts", icon: Coins, color: "text-yellow-500", isModule: true, moduleId: "bazaar", ownerOnly: false },
  { id: "reactions", label: "Reaction Roles", icon: Smile, color: "text-pink-500", isModule: true, moduleId: "reactions", ownerOnly: false },
  { id: "modules", label: "Modules", icon: ShieldCheck, color: "text-indigo-500", isModule: false, ownerOnly: true },
];

export interface GuildConfigScaffoldProps {
  guildId: string;
  guildName: string;
  guildIcon: string | null;
  memberCount?: number;
  initialConfig: Partial<GuildConfigDocument>;
  hasApiKey: boolean;
  apiKeys: MaskedGuildApiKey[];
  systemModules: SystemModuleDocument[];
  isBotOwner: boolean;
  channels: { id: string; name: string; type: number }[];
  roles: { id: string; name: string; color: number; position: number }[];
  mutualGuilds: { id: string; name: string; icon: string | null }[];
}

const ensureArray = (val: unknown): string[] => {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      if (val.trim()) return [val.trim()];
    }
  }
  return [];
};

interface SidebarContentProps {
  guildId: string;
  guildName: string;
  guildIcon: string | null;
  mutualGuilds: { id: string; name: string; icon: string | null }[];
  enabledModules: string[];
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  isBotOwner: boolean;
  onItemClick?: () => void;
}

function SidebarContent({
  guildId,
  guildName,
  guildIcon,
  mutualGuilds,
  enabledModules,
  activeTab,
  setActiveTab,
  isBotOwner,
  onItemClick,
}: SidebarContentProps) {
  const [isServerDropdownOpen, setIsServerDropdownOpen] = useState(false);

  return (
    <div className="flex flex-col h-full bg-zinc-50/50 dark:bg-zinc-950/50 border-r border-zinc-200/60 dark:border-zinc-800/40">
      {/* Back to Server Selection Button */}
      <div className="p-3 pb-0">
        <Link
          href="/"
          className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 rounded-xl transition-all group cursor-pointer"
        >
          <ArrowLeft className="size-3.5 text-zinc-400 group-hover:-translate-x-0.5 transition-transform" />
          <span>Back to Servers</span>
        </Link>
      </div>

      {/* Server Selector Header */}
      <div className="p-4 pt-2 border-b border-zinc-200/60 dark:border-zinc-800/40 relative">
        <button
          onClick={() => setIsServerDropdownOpen(!isServerDropdownOpen)}
          className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left group cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            {guildIcon ? (
              <Image
                src={`https://cdn.discordapp.com/icons/${guildId}/${guildIcon}.png`}
                alt={guildName}
                width={36}
                height={36}
                className="rounded-full object-cover shrink-0 ring-1 ring-black/10 dark:ring-white/10"
              />
            ) : (
              <div className="size-9 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center font-bold text-sm shrink-0">
                {guildName.substring(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-sm text-zinc-900 dark:text-white truncate group-hover:text-emerald-500 transition-colors">
                {guildName}
              </h3>
              <p className="text-[10px] text-zinc-500 font-mono truncate">ID: {guildId}</p>
            </div>
          </div>
          <ChevronRight className={`size-4 text-zinc-400 transition-transform duration-200 shrink-0 ${isServerDropdownOpen ? "rotate-90" : ""}`} />
        </button>

        {isServerDropdownOpen && (
          <div className="absolute top-full left-4 right-4 mt-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
            <div className="text-[10px] font-bold text-zinc-400 px-3 py-1.5 uppercase tracking-wider">
              Switch Server
            </div>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {mutualGuilds
                .filter((g) => g.id !== guildId)
                .map((guild) => (
                  <Link
                    key={guild.id}
                    href={`/guilds/${guild.id}`}
                    onClick={() => setIsServerDropdownOpen(false)}
                    className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left group"
                  >
                    {guild.icon ? (
                      <Image
                        src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`}
                        alt={guild.name}
                        width={24}
                        height={24}
                        className="rounded-lg object-cover"
                      />
                    ) : (
                      <div className="size-6 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center font-bold text-[10px]">
                        {guild.name.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate group-hover:text-zinc-900 dark:group-hover:text-white">
                      {guild.name}
                    </span>
                  </Link>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Navigation Menu */}
      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
        {baseMenuItems
          .filter((item) => !item.ownerOnly || isBotOwner)
          .map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isEnabled = !item.isModule || (item.moduleId && enabledModules.includes(item.moduleId));

            return (
              <button
                key={item.id}
                disabled={!isEnabled}
                onClick={() => {
                  if (!isEnabled) return;
                  setActiveTab(item.id);
                  if (onItemClick) onItemClick();
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all group ${!isEnabled
                  ? "opacity-40 cursor-not-allowed text-zinc-400 dark:text-zinc-600"
                  : isActive
                    ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-xs border border-zinc-200/80 dark:border-zinc-800 cursor-pointer"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  }`}
              >
                <Icon className={`size-4 transition-colors ${isActive ? item.color : "text-current"}`} />
                <span className="flex-1 text-left">{item.label}</span>
                <ChevronRight className={`size-3 opacity-0 ${isEnabled ? "group-hover:opacity-100" : ""} transition-opacity ${isActive ? "opacity-100" : ""}`} />
              </button>
            );
          })}
      </nav>
    </div>
  );
}

export function GuildConfigScaffold({
  guildId,
  guildName,
  guildIcon,
  initialConfig,
  apiKeys,
  systemModules,
  isBotOwner,
  channels,
  roles,
  mutualGuilds,
}: GuildConfigScaffoldProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTabState] = useState<TabType>("settings");

  const setActiveTab = (tab: TabType) => {
    setActiveTabState(tab);
    if (typeof window !== "undefined") {
      localStorage.setItem(`sentinel_tab_${guildId}`, tab);
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.replaceState(null, "", url.toString());
    }
  };

  const [enabledModulesInput, setEnabledModulesInput] = useState<string[]>(
    ensureArray(initialConfig.enabled_modules)
  );

  const isTabEnabled = (tabId: TabType, enabledModulesList: string[]): boolean => {
    const menuItem = baseMenuItems.find((m) => m.id === tabId);
    if (!menuItem) return false;
    if (menuItem.ownerOnly && !isBotOwner) return false;
    if (menuItem.isModule && menuItem.moduleId) {
      return enabledModulesList.includes(menuItem.moduleId);
    }
    return true;
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlTab = searchParams.get("tab") as TabType;
    if (urlTab && isTabEnabled(urlTab, enabledModulesInput)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTabState(urlTab);
      localStorage.setItem(`sentinel_tab_${guildId}`, urlTab);
      return;
    }
    const storedTab = localStorage.getItem(`sentinel_tab_${guildId}`) as TabType;
    if (storedTab && isTabEnabled(storedTab, enabledModulesInput)) {
      setActiveTabState(storedTab);
      return;
    }
    if (!isTabEnabled(activeTab, enabledModulesInput)) {
      setActiveTabState("settings");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, guildId, enabledModulesInput, isBotOwner, activeTab]);

  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [config, setConfig] = useState<Partial<GuildConfigDocument>>(initialConfig);
  const [apiKeysList, setApiKeysList] = useState(apiKeys);
  const [deinitializing, setDeinitializing] = useState(false);
  const [showDeinitModal, setShowDeinitModal] = useState(false);

  // Form States for Guild Config
  const [verifiedRoles, setVerifiedRoles] = useState<string[]>(
    ensureArray(initialConfig.verified_role_ids || (initialConfig.verified_role_id ? [initialConfig.verified_role_id] : []))
  );
  const [verifyOnJoinInput, setVerifyOnJoinInput] = useState<boolean>(
    initialConfig.verify_on_join ?? true
  );
  const [verifyCronInput, setVerifyCronInput] = useState<boolean>(
    initialConfig.verify_cron ?? true
  );
  const [verifyCronIntervalInput, setVerifyCronIntervalInput] = useState<number>(
    initialConfig.verify_cron_interval ?? 1
  );

  const [strictFactionRoles, setStrictFactionRoles] = useState<string[]>(
    ensureArray(initialConfig.strict_faction_role_ids)
  );

  const handleAddStrictFactionRole = (roleId: string) => {
    if (!strictFactionRoles.includes(roleId)) {
      setStrictFactionRoles([...strictFactionRoles, roleId]);
    }
  };

  const handleRemoveStrictFactionRole = (roleId: string) => {
    setStrictFactionRoles(strictFactionRoles.filter((id) => id !== roleId));
  };

  const [logChannelInput, setLogChannelInput] = useState<string>(
    initialConfig.log_channel_id || ""
  );
  const [factionListChannelInput, setFactionListChannelInput] = useState<string>(
    initialConfig.faction_list_channel_id || ""
  );

  const [adminRoleIdsInput, setAdminRoleIdsInput] = useState<string[]>(
    ensureArray(initialConfig.admin_role_ids)
  );

  const [ttFullChannelInput, setTtFullChannelInput] = useState<string>(
    initialConfig.tt_full_channel_id || ""
  );
  const [ttFilteredChannelInput, setTtFilteredChannelInput] = useState<string>(
    initialConfig.tt_filtered_channel_id || ""
  );
  const [ttTerritoryIdsInput, setTtTerritoryIdsInput] = useState<string[]>(
    ensureArray(initialConfig.tt_territory_ids)
  );
  const [ttFactionIdsInput, setTtFactionIdsInput] = useState<number[]>(
    ensureArray(initialConfig.tt_faction_ids).map(Number).filter((n) => !isNaN(n) && n > 0)
  );

  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [addingApiKey, setAddingApiKey] = useState<boolean>(false);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);

  // Delete Modal States
  const [deleteApiKeyId, setDeleteApiKeyId] = useState<string | null>(null);
  const [isDeletingApiKey, setIsDeletingApiKey] = useState<boolean>(false);

  const [deleteMappingId, setDeleteMappingId] = useState<string | null>(null);
  const [isDeletingMapping, setIsDeletingMapping] = useState<boolean>(false);

  const isDirty = useMemo(() => {
    const templateChanged = (config.nickname_template || "") !== (initialConfig.nickname_template || "");
    const verifyJoinChanged = verifyOnJoinInput !== (initialConfig.verify_on_join ?? true);
    const verifyCronChanged = verifyCronInput !== (initialConfig.verify_cron ?? true);
    const verifyIntervalChanged = verifyCronIntervalInput !== (initialConfig.verify_cron_interval ?? 1);
    const logChannelChanged = (logChannelInput || "") !== (initialConfig.log_channel_id || "");
    const factionChannelChanged = (factionListChannelInput || "") !== (initialConfig.faction_list_channel_id || "");

    const ttFullChanged = (ttFullChannelInput || "") !== (initialConfig.tt_full_channel_id || "");
    const ttFilteredChanged = (ttFilteredChannelInput || "") !== (initialConfig.tt_filtered_channel_id || "");

    const initialVerified = ensureArray(initialConfig.verified_role_ids || (initialConfig.verified_role_id ? [initialConfig.verified_role_id] : []));
    const verifiedChanged = JSON.stringify([...verifiedRoles].sort()) !== JSON.stringify([...initialVerified].sort());

    const initialEnabledMod = ensureArray(initialConfig.enabled_modules);
    const modulesChanged = JSON.stringify([...enabledModulesInput].sort()) !== JSON.stringify([...initialEnabledMod].sort());

    const initialAdmin = ensureArray(initialConfig.admin_role_ids);
    const adminChanged = JSON.stringify([...adminRoleIdsInput].sort()) !== JSON.stringify([...initialAdmin].sort());

    const initialTerritories = ensureArray(initialConfig.tt_territory_ids);
    const territoriesChanged = JSON.stringify([...ttTerritoryIdsInput].sort()) !== JSON.stringify([...initialTerritories].sort());

    const initialStrict = ensureArray(initialConfig.strict_faction_role_ids);
    const strictChanged = JSON.stringify([...strictFactionRoles].sort()) !== JSON.stringify([...initialStrict].sort());

    const initialFactions = ensureArray(initialConfig.tt_faction_ids).map(Number).filter((n) => !isNaN(n) && n > 0);
    const factionsChanged = JSON.stringify([...ttFactionIdsInput].sort()) !== JSON.stringify([...initialFactions].sort());

    return (
      templateChanged ||
      verifyJoinChanged ||
      verifyCronChanged ||
      verifyIntervalChanged ||
      logChannelChanged ||
      factionChannelChanged ||
      ttFullChanged ||
      ttFilteredChanged ||
      verifiedChanged ||
      modulesChanged ||
      adminChanged ||
      territoriesChanged ||
      factionsChanged ||
      strictChanged
    );
  }, [
    config.nickname_template,
    verifyOnJoinInput,
    verifyCronInput,
    verifyCronIntervalInput,
    logChannelInput,
    factionListChannelInput,
    ttFullChannelInput,
    ttFilteredChannelInput,
    verifiedRoles,
    enabledModulesInput,
    adminRoleIdsInput,
    ttTerritoryIdsInput,
    ttFactionIdsInput,
    strictFactionRoles,
    initialConfig,
  ]);

  const handleDiscardChanges = () => {
    setConfig(initialConfig);
    setVerifiedRoles(
      ensureArray(initialConfig.verified_role_ids || (initialConfig.verified_role_id ? [initialConfig.verified_role_id] : []))
    );
    setVerifyOnJoinInput(initialConfig.verify_on_join ?? true);
    setVerifyCronInput(initialConfig.verify_cron ?? true);
    setVerifyCronIntervalInput(initialConfig.verify_cron_interval ?? 1);
    setStrictFactionRoles(ensureArray(initialConfig.strict_faction_role_ids));
    setLogChannelInput(initialConfig.log_channel_id || "");
    setFactionListChannelInput(initialConfig.faction_list_channel_id || "");
    setEnabledModulesInput(ensureArray(initialConfig.enabled_modules));
    setAdminRoleIdsInput(ensureArray(initialConfig.admin_role_ids));
    setTtFullChannelInput(initialConfig.tt_full_channel_id || "");
    setTtFilteredChannelInput(initialConfig.tt_filtered_channel_id || "");
    setTtTerritoryIdsInput(ensureArray(initialConfig.tt_territory_ids));
    setTtFactionIdsInput(ensureArray(initialConfig.tt_faction_ids).map(Number).filter((n) => !isNaN(n) && n > 0));
    toast.info("Unsaved configuration changes discarded.");
  };

  // Faction Mappings state
  const [factionMappings, setFactionMappings] = useState<FactionRoleMappingDocument[]>([]);
  const [loadingMappings, setLoadingMappings] = useState<boolean>(false);
  const [showMappingModal, setShowMappingModal] = useState<boolean>(false);
  const [editingMapping, setEditingMapping] = useState<FactionRoleMappingDocument | null>(null);
  const [savingMapping, setSavingMapping] = useState<boolean>(false);

  // Modal Form States
  const [formFactionId, setFormFactionId] = useState<string>("");
  const [formFactionName, setFormFactionName] = useState<string>("");
  const [isFetchingFactionName, setIsFetchingFactionName] = useState<boolean>(false);
  const [formEnabled, setFormEnabled] = useState<boolean>(true);
  const [formMemberRoles, setFormMemberRoles] = useState<string[]>([]);
  const [formLeaderRoles, setFormLeaderRoles] = useState<string[]>([]);

  const handleFetchFactionName = async () => {
    const num = Number(formFactionId);
    if (!formFactionId.trim() || isNaN(num) || num <= 0) {
      toast.error("Please enter a valid Faction ID first.");
      return;
    }

    setIsFetchingFactionName(true);
    try {
      const res = await getFactionInfo(guildId, num);
      if (res.success && res.faction?.name) {
        setFormFactionName(res.faction.name);
        toast.success(`Found faction: ${res.faction.name}`);
      } else {
        toast.error("Faction not found or invalid Faction ID.");
      }
    } catch {
      toast.error("Failed to fetch faction details.");
    } finally {
      setIsFetchingFactionName(false);
    }
  };

  useEffect(() => {
    async function loadMappings() {
      setLoadingMappings(true);
      try {
        const res = await getFactionRoleMappings(guildId);
        if (res.success && res.mappings) {
          setFactionMappings(res.mappings);
        }
      } catch (err) {
        console.error("Failed to load faction mappings:", err);
      } finally {
        setLoadingMappings(false);
      }
    }
    loadMappings();
  }, [guildId]);

  const handleToggleModule = (moduleId: string) => {
    if (enabledModulesInput.includes(moduleId)) {
      setEnabledModulesInput(enabledModulesInput.filter((m) => m !== moduleId));
    } else {
      setEnabledModulesInput([...enabledModulesInput, moduleId]);
    }
  };

  const handleAddAdminRole = (roleId: string) => {
    if (!adminRoleIdsInput.includes(roleId)) {
      setAdminRoleIdsInput([...adminRoleIdsInput, roleId]);
    }
  };

  const handleRemoveAdminRole = (roleId: string) => {
    setAdminRoleIdsInput(adminRoleIdsInput.filter((id) => id !== roleId));
  };

  const handleAddVerifiedRole = (roleId: string) => {
    if (!verifiedRoles.includes(roleId)) {
      setVerifiedRoles([...verifiedRoles, roleId]);
    }
  };

  const handleRemoveVerifiedRole = (roleId: string) => {
    setVerifiedRoles(verifiedRoles.filter((id) => id !== roleId));
  };

  const handleAddApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setAddingApiKey(true);
    try {
      const res = await addGuildApiKey(guildId, apiKeyInput.trim());
      if (res.success && res.apiKey) {
        toast.success("API key verified and added successfully!");
        setApiKeysList([...apiKeysList, res.apiKey]);
        setApiKeyInput("");
      } else {
        toast.error(res.error || "Failed to verify or add API key.");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message || "Error validating API key.");
    } finally {
      setAddingApiKey(false);
    }
  };

  const handleDeleteApiKey = (keyId: string) => {
    setDeleteApiKeyId(keyId);
  };

  const confirmDeleteApiKey = async () => {
    if (!deleteApiKeyId) return;
    setIsDeletingApiKey(true);
    try {
      const res = await deleteGuildApiKey(guildId, deleteApiKeyId);
      if (res.success) {
        toast.success("API key deleted successfully.");
        const updatedList = apiKeysList.filter((k) => k.id !== deleteApiKeyId);
        setApiKeysList(updatedList);
      } else {
        toast.error(res.error || "Failed to delete API key.");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message || "Error deleting API key.");
    } finally {
      setIsDeletingApiKey(false);
      setDeleteApiKeyId(null);
    }
  };

  const handleSetApiKeyPrimary = async (keyId: string) => {
    try {
      const res = await setGuildApiKeyPrimary(guildId, keyId);
      if (res.success) {
        toast.success("Primary API key updated.");
        setApiKeysList(
          apiKeysList.map((k) => ({
            ...k,
            is_primary: k.id === keyId,
          }))
        );
      } else {
        toast.error(res.error || "Failed to update primary API key.");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message || "Error setting primary key.");
    }
  };

  const handleOpenAddMapping = () => {
    setEditingMapping(null);
    setFormFactionId("");
    setFormFactionName("");
    setFormEnabled(true);
    setFormMemberRoles([]);
    setFormLeaderRoles([]);
    setShowMappingModal(true);
  };

  const handleOpenEditMapping = (mapping: FactionRoleMappingDocument) => {
    setEditingMapping(mapping);
    setFormFactionId(mapping.faction_id.toString());
    setFormFactionName(mapping.faction_name || "");
    setFormEnabled(mapping.enabled);
    setFormMemberRoles(ensureArray(mapping.member_role_ids));
    setFormLeaderRoles(ensureArray(mapping.leader_role_ids));
    setShowMappingModal(true);
  };

  const handleSaveMapping = async () => {
    const fIdNum = Number(formFactionId);
    if (!formFactionId || isNaN(fIdNum) || fIdNum <= 0) {
      toast.error("Please enter a valid numeric Faction ID.");
      return;
    }

    setSavingMapping(true);
    try {
      if (editingMapping) {
        const res = await updateFactionRoleMapping(guildId, editingMapping.id, {
          faction_id: fIdNum,
          faction_name: formFactionName.trim() || null,
          enabled: formEnabled,
          member_role_ids: formMemberRoles,
          leader_role_ids: formLeaderRoles,
        });

        if (res.success && res.mapping) {
          toast.success("Faction mapping updated successfully!");
          setFactionMappings(
            factionMappings.map((m) => (m.id === editingMapping.id ? res.mapping! : m))
          );
          setShowMappingModal(false);
        } else {
          toast.error(res.error || "Failed to update mapping.");
        }
      } else {
        const res = await createFactionRoleMapping(guildId, {
          faction_id: fIdNum,
          faction_name: formFactionName.trim() || null,
          enabled: formEnabled,
          member_role_ids: formMemberRoles,
          leader_role_ids: formLeaderRoles,
        });

        if (res.success && res.mapping) {
          toast.success("Faction mapping created successfully!");
          setFactionMappings([...factionMappings, res.mapping]);
          setShowMappingModal(false);
        } else {
          toast.error(res.error || "Failed to create mapping.");
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message || "Error saving mapping.");
    } finally {
      setSavingMapping(false);
    }
  };

  const handleToggleMappingEnabled = async (mapping: FactionRoleMappingDocument) => {
    try {
      const res = await updateFactionRoleMapping(guildId, mapping.id, {
        enabled: !mapping.enabled,
      });
      if (res.success && res.mapping) {
        setFactionMappings(
          factionMappings.map((m) => (m.id === mapping.id ? res.mapping! : m))
        );
        toast.success(`Mapping ${!mapping.enabled ? "enabled" : "disabled"}.`);
      } else {
        toast.error(res.error || "Failed to update status.");
      }
    } catch {
      toast.error("Error updating status.");
    }
  };

  const handleDeleteMapping = (mappingId: string) => {
    setDeleteMappingId(mappingId);
  };

  const confirmDeleteMapping = async () => {
    if (!deleteMappingId) return;
    setIsDeletingMapping(true);
    try {
      const res = await deleteFactionRoleMapping(guildId, deleteMappingId);
      if (res.success) {
        toast.success("Faction mapping deleted.");
        setFactionMappings(factionMappings.filter((m) => m.id !== deleteMappingId));
      } else {
        toast.error(res.error || "Failed to delete mapping.");
      }
    } catch {
      toast.error("Error deleting mapping.");
    } finally {
      setIsDeletingMapping(false);
      setDeleteMappingId(null);
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const payload: Partial<GuildConfigDocument> = {
        nickname_template: config.nickname_template,
        verified_role_ids: verifiedRoles,
        verified_role_id: verifiedRoles[0] || null,
        verify_on_join: verifyOnJoinInput,
        verify_cron: verifyCronInput,
        verify_cron_interval: verifyCronIntervalInput,
        log_channel_id: logChannelInput || null,
        faction_list_channel_id: factionListChannelInput || null,
        enabled_modules: enabledModulesInput,
        admin_role_ids: adminRoleIdsInput,
        tt_full_channel_id: ttFullChannelInput || null,
        tt_filtered_channel_id: ttFilteredChannelInput || null,
        tt_territory_ids: ttTerritoryIdsInput,
        tt_faction_ids: ttFactionIdsInput,
        strict_faction_role_ids: strictFactionRoles,
      };

      const res = await updateGuildConfig(guildId, payload);
      if (res.success) {
        toast.success("Server configuration saved successfully!");
        // Refresh the page server-side so initialConfig reflects the new saved state,
        // which clears isDirty and re-enables sidebar module links if modules changed.
        router.refresh();
      } else {
        toast.error(res.error || "Failed to save configuration.");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message || "Error saving configuration.");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleDeinitializeGuild = async () => {
    setDeinitializing(true);
    try {
      const res = await deinitializeGuild(guildId);
      if (res.success) {
        toast.success("Guild configuration wiped successfully.");
        router.push("/tt-selector");
      } else {
        toast.error(res.error || "Failed to deinitialize guild.");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message || "Error deinitializing guild.");
    } finally {
      setDeinitializing(false);
      setShowDeinitModal(false);
    }
  };

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans selection:bg-emerald-500/20">
      {/* Background Atmosphere (matching main server selection page) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-linear-to-br from-zinc-100 to-zinc-50 dark:from-zinc-900 dark:to-zinc-950" />
        <div className="absolute top-[-20%] left-[-10%] h-[700px] w-[700px] rounded-full bg-blue-500/10 dark:bg-blue-600/15 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[700px] w-[700px] rounded-full bg-indigo-500/10 dark:bg-indigo-600/15 blur-[120px]" />

        {/* Subtle Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000005_1px,transparent_1px),linear-gradient(to_bottom,#00000005_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_0%,#000_70%,transparent_100%)]" />
      </div>

      {/* Desktop Floating Sidebar */}
      <aside className="hidden md:block w-72 shrink-0 h-screen p-4 sticky top-0 z-20">
        <div className="h-full rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl shadow-xl overflow-hidden flex flex-col">
          <SidebarContent
            guildId={guildId}
            guildName={guildName}
            guildIcon={guildIcon}
            mutualGuilds={mutualGuilds}
            enabledModules={ensureArray(initialConfig.enabled_modules)}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            isBotOwner={isBotOwner}
          />
        </div>
      </aside>

      {/* Mobile Drawer Sheet */}
      <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
        <SheetContent side="left" className="p-0 w-80 bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800">
          <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          <SidebarContent
            guildId={guildId}
            guildName={guildName}
            guildIcon={guildIcon}
            mutualGuilds={mutualGuilds}
            enabledModules={ensureArray(initialConfig.enabled_modules)}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            isBotOwner={isBotOwner}
            onItemClick={() => setIsMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Main Content Workspace (Scrolls Independently) */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto relative z-10">
        {/* Dynamic Island Floating Header */}
        {(() => {
          const currentMenuItem = baseMenuItems.find((m) => m.id === activeTab) || baseMenuItems[0];
          const ActiveTabIcon = currentMenuItem.icon;

          return (
            <header className="sticky top-0 z-30 pt-4 px-4 pb-2 bg-transparent pointer-events-none">
              <div className="max-w-6xl w-full mx-auto flex items-center justify-between px-5 py-2.5 rounded-full border border-zinc-200/80 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-2xl shadow-xl shadow-black/5 dark:shadow-black/40 transition-all duration-300 pointer-events-auto">
                {/* Left: Mobile Menu & Tab Breadcrumb */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIsMobileOpen(true)}
                    className="md:hidden p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/5 text-zinc-500 transition-colors cursor-pointer"
                  >
                    <Menu className="size-4" />
                  </button>

                  <div className="flex items-center gap-2.5 font-medium">
                    <div className={`p-1.5 rounded-full bg-black/5 dark:bg-white/5 ${currentMenuItem.color}`}>
                      <ActiveTabIcon className="size-4" />
                    </div>
                    <span className="text-xs text-zinc-400 font-semibold hidden sm:inline">{guildName}</span>
                    <span className="text-xs text-zinc-400 font-semibold hidden sm:inline">/</span>
                    <span className="text-sm font-bold text-zinc-900 dark:text-white capitalize">
                      {currentMenuItem.label}
                    </span>
                  </div>
                </div>

                {/* Right: Actions & Dynamic Dirty Indicator */}
                <div className="flex items-center gap-2">
                  <ThemeToggle />
                  {isDirty && (
                    <>
                      <Badge variant="outline" className="hidden sm:flex items-center gap-1.5 py-1 px-3 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[11px] font-medium animate-in fade-in duration-200">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Unsaved Changes
                      </Badge>

                      <Button
                        variant="ghost"
                        onClick={handleDiscardChanges}
                        disabled={savingConfig}
                        className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer h-8 px-3 rounded-full transition-colors"
                      >
                        <RotateCcw className="size-3.5 mr-1" />
                        Discard
                      </Button>
                    </>
                  )}

                  <Button
                    onClick={handleSaveConfig}
                    disabled={!isDirty || savingConfig}
                    className={`font-bold h-8 px-4 rounded-full transition-all text-xs ${isDirty
                      ? "bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white cursor-pointer shadow-md shadow-emerald-500/30"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed opacity-50"
                      }`}
                  >
                    <Save className="size-3.5 mr-1.5" />
                    {savingConfig ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </header>
          );
        })()}

        {/* Content Views Routing */}
        <main className="flex-1 p-6 md:p-10 max-w-6xl w-full mx-auto">
          {activeTab === "verification" && (
            <VerificationTab
              config={config}
              setConfig={setConfig}
              verifiedRoles={verifiedRoles}
              handleAddVerifiedRole={handleAddVerifiedRole}
              handleRemoveVerifiedRole={handleRemoveVerifiedRole}
              verifyOnJoinInput={verifyOnJoinInput}
              setVerifyOnJoinInput={setVerifyOnJoinInput}
              verifyCronInput={verifyCronInput}
              setVerifyCronInput={setVerifyCronInput}
              verifyCronIntervalInput={verifyCronIntervalInput}
              setVerifyCronIntervalInput={setVerifyCronIntervalInput}
              factionListChannelInput={factionListChannelInput}
              setFactionListChannelInput={setFactionListChannelInput}
              factionMappings={factionMappings}
              loadingMappings={loadingMappings}
              roles={roles}
              channels={channels}
              handleOpenAddMapping={handleOpenAddMapping}
              handleOpenEditMapping={handleOpenEditMapping}
              handleToggleMappingEnabled={handleToggleMappingEnabled}
              handleDeleteMapping={handleDeleteMapping}
              strictFactionRoles={strictFactionRoles}
              handleAddStrictFactionRole={handleAddStrictFactionRole}
              handleRemoveStrictFactionRole={handleRemoveStrictFactionRole}
              ensureArray={ensureArray}
            />
          )}

          {activeTab === "territories" && (
            <TerritoryTab
              guildId={guildId}
              ttFullChannelInput={ttFullChannelInput}
              setTtFullChannelInput={setTtFullChannelInput}
              ttFilteredChannelInput={ttFilteredChannelInput}
              setTtFilteredChannelInput={setTtFilteredChannelInput}
              ttTerritoryIdsInput={ttTerritoryIdsInput}
              setTtTerritoryIdsInput={setTtTerritoryIdsInput}
              ttFactionIdsInput={ttFactionIdsInput}
              setTtFactionIdsInput={setTtFactionIdsInput}
              channels={channels}
              factionMappings={factionMappings}
            />
          )}

          {activeTab === "bazaar" && <BazaarTab />}

          {activeTab === "reactions" && (
            <ReactionsTab
              guildId={guildId}
              channels={channels}
              roles={roles}
            />
          )}

          {activeTab === "modules" && (
            <ModulesTab
              systemModules={systemModules}
              enabledModulesInput={enabledModulesInput}
              handleToggleModule={handleToggleModule}
            />
          )}

          {activeTab === "settings" && (
            <SettingsTab
              guildId={guildId}
              isBotOwner={isBotOwner}
              logChannelInput={logChannelInput}
              setLogChannelInput={setLogChannelInput}
              channels={channels}
              roles={roles}
              adminRoleIdsInput={adminRoleIdsInput}
              handleAddAdminRole={handleAddAdminRole}
              handleRemoveAdminRole={handleRemoveAdminRole}
              apiKeysList={apiKeysList}
              apiKeyInput={apiKeyInput}
              setApiKeyInput={setApiKeyInput}
              addingApiKey={addingApiKey}
              handleAddApiKey={handleAddApiKey}
              handleDeleteApiKey={handleDeleteApiKey}
              handleSetApiKeyPrimary={handleSetApiKeyPrimary}
              setShowDeinitModal={setShowDeinitModal}
            />
          )}
        </main>

        {/* Extracted Modals */}
        <FactionMappingModal
          showMappingModal={showMappingModal}
          setShowMappingModal={setShowMappingModal}
          editingMapping={editingMapping}
          formFactionId={formFactionId}
          setFormFactionId={setFormFactionId}
          formFactionName={formFactionName}
          isFetchingFactionName={isFetchingFactionName}
          handleFetchFactionName={handleFetchFactionName}
          formEnabled={formEnabled}
          setFormEnabled={setFormEnabled}
          formMemberRoles={formMemberRoles}
          setFormMemberRoles={setFormMemberRoles}
          formLeaderRoles={formLeaderRoles}
          setFormLeaderRoles={setFormLeaderRoles}
          roles={roles}
          handleSaveMapping={handleSaveMapping}
          savingMapping={savingMapping}
          ensureArray={ensureArray}
        />

        <DeinitializeModal
          showDeinitModal={showDeinitModal}
          setShowDeinitModal={setShowDeinitModal}
          deinitializing={deinitializing}
          handleDeinitializeGuild={handleDeinitializeGuild}
        />

        <DeleteConfirmModal
          isOpen={!!deleteApiKeyId}
          onClose={() => setDeleteApiKeyId(null)}
          onConfirm={confirmDeleteApiKey}
          title="Delete API Key"
          description="Are you sure you want to delete this API Key? Any background automation relying on this key will stop functioning."
          confirmLabel="Delete API Key"
          isDeleting={isDeletingApiKey}
        />

        <DeleteConfirmModal
          isOpen={!!deleteMappingId}
          onClose={() => setDeleteMappingId(null)}
          onConfirm={confirmDeleteMapping}
          title="Delete Faction Mapping"
          description="Are you sure you want to delete this faction role mapping? Automated member role sync for this faction will be removed."
          confirmLabel="Delete Mapping"
          isDeleting={isDeletingMapping}
        />
      </div>
    </div>
  );
}
