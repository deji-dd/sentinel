import React, {
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  forwardRef,
} from "react";
import { LoadingScreen } from "@/components/loading-screen";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { fetchWithFallback } from "@/lib/api-base";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import {
  ShieldAlert,
  Pause,
  Play,
  CircleOff,
  Save,
  Plus,
  ChevronDown,
  Calendar as CalendarIcon,
  Clock,
  X,
  DollarSign,
  Users,
  Activity,
  BarChart2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ContractStatus =
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "closed";

type MercenarySettings = {
  contract_announcement_channel_id: string | null;
  hit_post_channel_id: string | null;
  payout_channel_id: string | null;
  audit_channel_id: string | null;
  merc_registration_channel_id: string | null;
  max_active_dibs_per_person: number;
  dibs_remaining_minutes: number;
  dibs_enabled: number;
  merc_role_ids?: string[];
};

type MercenaryContract = {
  id: string;
  title: string;
  description: string | null;
  contract_type: string;
  status: ContractStatus;
  pay_amount: number;
  pay_currency: string;
  pay_terms: string | null;
  start_at: string | null;
  ends_at: string | null;
  faction_id: number | null;
  faction_name: string | null;
  target_scope: string;
  idle_minutes: number | null;
  auto_finish_on_war_end: number;
  min_level: number | null;
  max_level: number | null;
  require_faction_no_active_war: number;
  require_faction_no_upcoming_war: number;
  target_roles: string[];
  created_at: string;
  hit_count?: number;
  total_payout?: number;
};

type ContractDraft = {
  title: string;
  description: string;
  contract_type: string;
  pay_amount: string;
  start_at: string;
  ends_at: string;
  faction_id: string;
  faction_name: string;
  available_roles: string[];
  target_scope: string;
  idle_minutes: string;
  min_level: string;
  max_level: string;
  target_roles: string[];
};

const EMPTY_CONTRACT: ContractDraft = {
  title: "",
  description: "",
  contract_type: "hosp",
  pay_amount: "0",
  start_at: "",
  ends_at: "",
  faction_id: "",
  faction_name: "",
  available_roles: [],
  target_scope: "offline_and_idle",
  idle_minutes: "15",
  min_level: "",
  max_level: "",
  target_roles: [],
};

interface DatePickerTimeProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function DatePickerTime({ value, onChange, placeholder }: DatePickerTimeProps) {
  const [open, setOpen] = useState(false);

  // Parse local Date and time string from value (YYYY-MM-DDTHH:MM)
  const { date, time } = useMemo(() => {
    if (!value) return { date: undefined, time: "" };
    const parts = value.split("T");
    const datePart = parts[0];
    const timePart = parts[1] || "";

    if (!datePart) return { date: undefined, time: "" };

    const [year, month, day] = datePart.split("-").map(Number);
    if (!year || !month || !day) return { date: undefined, time: "" };

    return {
      date: new Date(year, month - 1, day),
      time: timePart.substring(0, 5), // Keep only HH:MM
    };
  }, [value]);

  const handleDateSelect = (newDate: Date | undefined) => {
    if (!newDate) {
      onChange("");
      return;
    }
    const yyyy = newDate.getFullYear();
    const mm = String(newDate.getMonth() + 1).padStart(2, "0");
    const dd = String(newDate.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const timeStr = time || "00:00";
    onChange(`${dateStr}T${timeStr}`);
    setOpen(false);
  };

  const handleTimeChange = (newTime: string) => {
    const activeDate = date || new Date();
    const yyyy = activeDate.getFullYear();
    const mm = String(activeDate.getMonth() + 1).padStart(2, "0");
    const dd = String(activeDate.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    onChange(`${dateStr}T${newTime || "00:00"}`);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  return (
    <div className="flex gap-2 items-center w-full">
      <div className="flex-1 min-w-0">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              type="button"
              className="w-full justify-between font-normal text-left h-10 px-3 bg-background border-border/50 hover:bg-accent/50 hover:text-accent-foreground transition-all duration-200"
            >
              <span className="flex items-center gap-2 truncate">
                <CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                {date ? (
                  <span className="text-foreground">{format(date, "PPP")}</span>
                ) : (
                  <span className="text-muted-foreground">{placeholder || "Select date"}</span>
                )}
              </span>
              {date ? (
                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-full p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 border border-border bg-popover shadow-xl rounded-lg" align="start">
            <Calendar
              mode="single"
              selected={date}
              captionLayout="dropdown"
              defaultMonth={date || new Date()}
              onSelect={handleDateSelect}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="relative w-28 shrink-0">
        <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          type="time"
          value={time}
          onChange={(e) => handleTimeChange(e.target.value)}
          className="pl-9 pr-2 h-10 w-full appearance-none bg-background border-border/50 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none text-sm transition-all duration-200"
        />
      </div>
    </div>
  );
}

export const MercenaryConfig = forwardRef(
  (
    {
      sessionToken,
      initialData,
      onDirtyChange,
      activeSubTab = "settings",
    }: {
      sessionToken: string;
      initialData?: any;
      onDirtyChange?: (isDirty: boolean) => void;
      activeSubTab?: "settings" | "dibs" | "contracts";
    },
    ref,
  ) => {
    const [loading, setLoading] = useState(true);
    const [savingContract, setSavingContract] = useState(false);
    const [lookingUpFaction, setLookingUpFaction] = useState(false);
    const [settingsBaseline, setSettingsBaseline] =
      useState<MercenarySettings | null>(null);
    const [settings, setSettings] = useState<MercenarySettings | null>(null);
    const [activeContracts, setActiveContracts] = useState<MercenaryContract[]>(
      [],
    );
    const [pastContracts, setPastContracts] = useState<MercenaryContract[]>([]);
    const [editingContractId, setEditingContractId] = useState<string | null>(
      null,
    );
    const [draft, setDraft] = useState<ContractDraft>(EMPTY_CONTRACT);

    const [dashboardContract, setDashboardContract] =
      useState<MercenaryContract | null>(null);
    const [dashboardHits, setDashboardHits] = useState<any[]>([]);
    const [loadingHits, setLoadingHits] = useState(false);
    const [contractToClose, setContractToClose] =
      useState<MercenaryContract | null>(null);

    const availableRoles = useMemo(
      () => initialData?.roles || initialData?.available_roles || [],
      [initialData],
    );

    const availableChannels = useMemo(
      () => initialData?.channels || initialData?.available_channels || [],
      [initialData],
    );

    const settingsDirty = useMemo(() => {
      if (!settings || !settingsBaseline) return false;
      return JSON.stringify(settings) !== JSON.stringify(settingsBaseline);
    }, [settings, settingsBaseline]);

    useEffect(() => {
      onDirtyChange?.(settingsDirty);
    }, [settingsDirty, onDirtyChange]);

    const loadData = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const response = await fetchWithFallback("/api/config/mercenary", {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!response.ok) throw new Error("Failed to load mercenary config");
        const payload = await response.json();

        const loadedSettings = {
          ...payload.settings,
          merc_role_ids: payload.settings.merc_role_ids || [],
        };
        setSettings(loadedSettings);
        setSettingsBaseline(loadedSettings);
        setActiveContracts(payload.active_contracts || []);
        setPastContracts(payload.past_contracts || []);
      } catch (error) {
        console.error("[MercenaryConfig] Failed to load:", error);
        toast.error("Failed to load mercenary module data");
      } finally {
        if (!silent) setLoading(false);
      }
    };

    useEffect(() => {
      loadData();
    }, [sessionToken]);

    useEffect(() => {
      if (!dashboardContract) {
        setDashboardHits([]);
        return;
      }

      const fetchHits = async () => {
        setLoadingHits(true);
        try {
          const response = await fetchWithFallback(
            `/api/config/mercenary/contracts/${dashboardContract.id}/hits`,
            {
              headers: { Authorization: `Bearer ${sessionToken}` },
            },
          );
          if (!response.ok) throw new Error("Failed to fetch hits logs");
          const data = await response.json();
          setDashboardHits(data.hits || []);
        } catch (error) {
          console.error("Failed to load hits:", error);
          toast.error("Failed to load verified hits logs");
        } finally {
          setLoadingHits(false);
        }
      };

      fetchHits();
    }, [dashboardContract, sessionToken]);

    const dashboardSummary = useMemo(() => {
      if (!dashboardHits || dashboardHits.length === 0) {
        return {
          totalHits: 0,
          totalPayout: 0,
          uniqueMercs: 0,
          mercBreakdown: [],
        };
      }

      const verifiedHits = dashboardHits.filter((h) => h.result === "verified");

      const totalHits = verifiedHits.length;
      const totalPayout = verifiedHits.reduce(
        (sum, h) => sum + (h.payout_amount || 0),
        0,
      );

      const mercMap = new Map<
        string,
        { discordId: string; name: string; tornId: string; hits: number; payout: number }
      >();

      for (const hit of verifiedHits) {
        const mercId = hit.merc_discord_id || "unknown";
        const current = mercMap.get(mercId) || {
          discordId: mercId,
          name: hit.merc_name || "Unknown Merc",
          tornId: hit.merc_torn_id || "N/A",
          hits: 0,
          payout: 0,
        };
        current.hits += 1;
        current.payout += hit.payout_amount || 0;
        mercMap.set(mercId, current);
      }

      return {
        totalHits,
        totalPayout,
        uniqueMercs: mercMap.size,
        mercBreakdown: Array.from(mercMap.values()),
      };
    }, [dashboardHits]);

    const lookupFaction = async (factionId: string) => {
      if (!factionId.trim()) {
        return;
      }

      setLookingUpFaction(true);
      try {
        const response = await fetchWithFallback(
          `/api/config/mercenary/faction/${factionId}`,
          {
            headers: { Authorization: `Bearer ${sessionToken}` },
          },
        );

        if (!response.ok) {
          const body = await response
            .json()
            .catch(() => ({ error: "Failed to lookup faction" }));
          throw new Error(body.error || "Faction not found or error verifying");
        }

        const factionData = await response.json();
        const targetRoles =
          factionData.target_roles || factionData.available_roles || [];
        setDraft((current) => ({
          ...current,
          faction_id: factionId,
          faction_name: factionData.faction_name || "",
          title: factionData.faction_name || "",
          available_roles: factionData.available_roles || [],
          target_roles: targetRoles,
        }));

        toast.success("Faction verified");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to lookup faction",
        );
        setDraft((current) => ({
          ...current,
          faction_name: "",
          available_roles: [],
          target_roles: [],
        }));
      } finally {
        setLookingUpFaction(false);
      }
    };

    const saveSettings = async () => {
      if (!settings) return false;

      try {
        const response = await fetchWithFallback(
          "/api/config/mercenary/settings",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({
              ...settings,
              max_active_dibs_per_person: settings.max_active_dibs_per_person || 5,
              dibs_remaining_minutes: settings.dibs_remaining_minutes || 15,
            }),
          },
        );

        if (!response.ok) {
          const payload = await response
            .json()
            .catch(() => ({ error: "Failed to save settings" }));
          throw new Error(payload.error || "Failed to save settings");
        }

        toast.success("Mercenary settings saved");
        await loadData(true);
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to save settings",
        );
        return false;
      }
    };

    useImperativeHandle(ref, () => ({
      save: saveSettings,
    }));

    const updateDraft = (key: keyof ContractDraft, value: string | boolean) => {
      setDraft((current) => ({ ...current, [key]: value }));
    };

    const updateTargetRoles = (roles: string[]) => {
      setDraft((current) => ({ ...current, target_roles: roles }));
    };

    const resetDraft = () => {
      setEditingContractId(null);
      setDraft(EMPTY_CONTRACT);
    };

    const submitContract = async () => {
      if (!draft.faction_id.trim()) {
        toast.error("Faction ID is required");
        return;
      }

      if (!draft.title.trim()) {
        toast.error("Contract title is required");
        return;
      }

      setSavingContract(true);
      try {
        const payload = {
          title: draft.title,
          description: draft.description || null,
          contract_type: draft.contract_type,
          pay_amount: Number(draft.pay_amount) || 0,
          start_at: draft.start_at ? new Date(draft.start_at + "Z").toISOString() : null,
          ends_at: draft.ends_at ? new Date(draft.ends_at + "Z").toISOString() : null,
          faction_id: Number(draft.faction_id),
          target_scope: draft.target_scope,
          idle_minutes:
            draft.target_scope === "offline_and_idle" && draft.idle_minutes
              ? Number(draft.idle_minutes)
              : null,
          min_level: draft.min_level ? Number(draft.min_level) : null,
          max_level: draft.max_level ? Number(draft.max_level) : null,
          target_roles: draft.target_roles,
        };

        const endpoint = editingContractId
          ? `/api/config/mercenary/contracts/${editingContractId}`
          : "/api/config/mercenary/contracts";
        const method = editingContractId ? "PATCH" : "POST";

        const response = await fetchWithFallback(endpoint, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const body = await response
            .json()
            .catch(() => ({ error: "Failed to save contract" }));
          throw new Error(body.error || "Failed to save contract");
        }

        toast.success(
          editingContractId ? "Contract updated" : "Contract created",
        );
        resetDraft();
        await loadData(true);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to save contract",
        );
      } finally {
        setSavingContract(false);
      }
    };

    const editContract = async (contract: MercenaryContract) => {
      setEditingContractId(contract.id);
      setDraft({
        title: contract.title || "",
        description: contract.description || "",
        contract_type: contract.contract_type || "hosp",
        pay_amount: String(contract.pay_amount || 0),
        start_at: contract.start_at ? contract.start_at.substring(0, 16) : "",
        ends_at: contract.ends_at ? contract.ends_at.substring(0, 16) : "",
        faction_id: contract.faction_id ? String(contract.faction_id) : "",
        faction_name: contract.faction_name || "",
        available_roles: [],
        target_scope: contract.target_scope || "offline_and_idle",
        idle_minutes: contract.idle_minutes
          ? String(contract.idle_minutes)
          : "15",
        min_level: contract.min_level ? String(contract.min_level) : "",
        max_level: contract.max_level ? String(contract.max_level) : "",
        target_roles: contract.target_roles || [],
      });

      // Fetch available roles from the faction
      if (contract.faction_id) {
        setLookingUpFaction(true);
        try {
          const response = await fetchWithFallback(
            `/api/config/mercenary/faction/${contract.faction_id}`,
            {
              headers: { Authorization: `Bearer ${sessionToken}` },
            },
          );

          if (response.ok) {
            const factionData = await response.json();
            setDraft((current) => ({
              ...current,
              available_roles: factionData.available_roles || [],
            }));
          }
        } catch (error) {
          console.error("Failed to fetch available roles:", error);
        } finally {
          setLookingUpFaction(false);
        }
      }
    };

    const updateContractStatus = async (
      contractId: string,
      status: ContractStatus,
    ) => {
      try {
        const response = await fetchWithFallback(
          `/api/config/mercenary/contracts/${contractId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({ status }),
          },
        );

        if (!response.ok) {
          const body = await response
            .json()
            .catch(() => ({ error: "Failed to update contract" }));
          throw new Error(body.error || "Failed to update contract");
        }

        toast.success("Contract updated");
        await loadData(true);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update contract",
        );
      }
    };

    if (loading || !settings) {
      return (
        <LoadingScreen
          fullScreen={false}
          subMessage="Loading Mercenary Module"
        />
      );
    }

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        {activeSubTab === "settings" && (
          <div className="space-y-6">


            <div className="space-y-5 bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Contract Announcement Channel</Label>
                  <Select
                    value={settings.contract_announcement_channel_id || "none"}
                    onValueChange={(value) =>
                      setSettings((current) =>
                        current
                          ? {
                            ...current,
                            contract_announcement_channel_id:
                              value === "none" ? null : value,
                          }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select channel" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {availableChannels.map(
                        (channel: { id: string; name: string }) => (
                          <SelectItem key={channel.id} value={channel.id}>
                            {channel.name}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Hit Posting Channel</Label>
                  <Select
                    value={settings.hit_post_channel_id || "none"}
                    onValueChange={(value) =>
                      setSettings((current) =>
                        current
                          ? {
                            ...current,
                            hit_post_channel_id:
                              value === "none" ? null : value,
                          }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select channel" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {availableChannels.map(
                        (channel: { id: string; name: string }) => (
                          <SelectItem key={channel.id} value={channel.id}>
                            {channel.name}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Payout Channel</Label>
                  <Select
                    value={settings.payout_channel_id || "none"}
                    onValueChange={(value) =>
                      setSettings((current) =>
                        current
                          ? {
                            ...current,
                            payout_channel_id: value === "none" ? null : value,
                          }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select channel" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {availableChannels.map(
                        (channel: { id: string; name: string }) => (
                          <SelectItem key={channel.id} value={channel.id}>
                            {channel.name}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Audit Channel</Label>
                  <Select
                    value={settings.audit_channel_id || "none"}
                    onValueChange={(value) =>
                      setSettings((current) =>
                        current
                          ? {
                            ...current,
                            audit_channel_id: value === "none" ? null : value,
                          }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select channel" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {availableChannels.map(
                        (channel: { id: string; name: string }) => (
                          <SelectItem key={channel.id} value={channel.id}>
                            {channel.name}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Merc Registration Channel</Label>
                  <Select
                    value={settings.merc_registration_channel_id || "none"}
                    onValueChange={(value) =>
                      setSettings((current) =>
                        current
                          ? {
                            ...current,
                            merc_registration_channel_id:
                              value === "none" ? null : value,
                          }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select channel" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {availableChannels.map(
                        (channel: { id: string; name: string }) => (
                          <SelectItem key={channel.id} value={channel.id}>
                            {channel.name}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Mercenary Roles</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-between h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground hover:bg-accent hover:text-accent-foreground group"
                      >
                        <span className={`truncate ${(!settings.merc_role_ids || settings.merc_role_ids.length === 0) ? "text-muted-foreground" : "text-foreground"}`}>
                          {!settings.merc_role_ids ||
                            settings.merc_role_ids.length === 0
                            ? "Select Roles"
                            : settings.merc_role_ids
                              .map(
                                (id: string) =>
                                  availableRoles.find(
                                    (r: { id: string; name: string }) =>
                                      r.id === id,
                                  )?.name,
                              )
                              .filter(Boolean)
                              .join(", ")}
                        </span>
                        <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-60 overflow-y-auto p-2"
                      align="start"
                    >
                      <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest opacity-50 px-2 py-1.5">
                        Available Roles
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        checked={
                          !settings.merc_role_ids ||
                          settings.merc_role_ids.length === 0
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSettings((current) =>
                              current
                                ? { ...current, merc_role_ids: [] }
                                : null,
                            );
                          }
                        }}
                        className="rounded-lg font-semibold py-2 focus:bg-primary/10 transition-colors cursor-pointer italic text-muted-foreground"
                      >
                        None (Clear All)
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      {availableRoles.map(
                        (r: { id: string; name: string }) => (
                          <DropdownMenuCheckboxItem
                            key={r.id}
                            checked={
                              settings.merc_role_ids?.includes(r.id) || false
                            }
                            onCheckedChange={(checked) => {
                              setSettings((current) => {
                                if (!current) return null;
                                const ids = current.merc_role_ids || [];
                                return {
                                  ...current,
                                  merc_role_ids: checked
                                    ? [...ids, r.id]
                                    : ids.filter((id: string) => id !== r.id),
                                };
                              });
                            }}
                            className="rounded-lg font-semibold py-2 focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer"
                          >
                            {r.name}
                          </DropdownMenuCheckboxItem>
                        ),
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <p className="text-xs text-muted-foreground">
                    Roles to assign to users when they verify/register as
                    mercenaries.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSubTab === "dibs" && (
          <div className="space-y-6">


            <div className="space-y-5 bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Max Active Dibs Per Person</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={
                      settings.max_active_dibs_per_person === 0
                        ? ""
                        : (settings.max_active_dibs_per_person ?? "")
                    }
                    onChange={(e) =>
                      setSettings((current) =>
                        current
                          ? {
                            ...current,
                            max_active_dibs_per_person: Number(
                              e.target.value,
                            ),
                          }
                          : current,
                      )
                    }
                    placeholder="5"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Dibs Remaining Time (minutes)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={
                      settings.dibs_remaining_minutes === 0
                        ? ""
                        : (settings.dibs_remaining_minutes ?? "")
                    }
                    onChange={(e) =>
                      setSettings((current) =>
                        current
                          ? {
                            ...current,
                            dibs_remaining_minutes: Number(e.target.value),
                          }
                          : current,
                      )
                    }
                    placeholder="15"
                  />
                  <p className="text-xs text-muted-foreground">
                    Only targets with this much time left in hospital show in
                    dibs list
                  </p>
                </div>

                <div className="flex items-center justify-between col-span-2 pt-2">
                  <Label>Enable Dibs System</Label>
                  <Switch
                    checked={Boolean(settings.dibs_enabled)}
                    onCheckedChange={(v) =>
                      setSettings((current) =>
                        current
                          ? { ...current, dibs_enabled: v ? 1 : 0 }
                          : current,
                      )
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSubTab === "contracts" && (
          <div className="space-y-6">


            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              {/* Left Column: Create Contract */}
              <div className="space-y-5 bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs">
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-foreground">
                    {editingContractId ? "Edit Contract" : "Create Contract"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Contracts require faction verification and war-state checks before they can be saved.
                  </p>
                </div>

                {/* Faction ID Verification Gate */}
                {!draft.faction_name ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200 flex gap-2 items-center">
                      <ShieldAlert className="size-4 shrink-0" />
                      Enter faction ID to verify and auto-populate contract details
                    </div>
                    <div className="space-y-2">
                      <Label>Faction ID</Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          value={draft.faction_id}
                          onChange={(e) =>
                            updateDraft("faction_id", e.target.value)
                          }
                          placeholder="12345"
                        />
                        <Button
                          onClick={() => lookupFaction(draft.faction_id)}
                          disabled={lookingUpFaction || !draft.faction_id.trim()}
                        >
                          {lookingUpFaction ? "Verifying..." : "Verify"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Full Contract Form - After Faction Verification */}
                    <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-800 dark:text-green-200 flex gap-2 items-center">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      Faction verified:{" "}
                      <span className="font-semibold">{draft.faction_name}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2 md:col-span-2">
                        <Label>Contract Title</Label>
                        <Input
                          value={draft.title}
                          onChange={(e) => updateDraft("title", e.target.value)}
                          placeholder="Auto-populated from faction name"
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2">
                        <Label>Notes</Label>
                        <Textarea
                          value={draft.description || ""}
                          onChange={(e) =>
                            updateDraft("description", e.target.value)
                          }
                          placeholder="Use warlords on all hits"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Contract Type</Label>
                        <Select
                          value={draft.contract_type}
                          onValueChange={(v) => updateDraft("contract_type", v)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="leave">Leave</SelectItem>
                            <SelectItem value="mug">Mug</SelectItem>
                            <SelectItem value="hosp">Hospitalize</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Target Scope</Label>
                        <Select
                          value={draft.target_scope}
                          onValueChange={(v) => {
                            updateDraft("target_scope", v);
                            if (v !== "offline_and_idle") {
                              updateDraft("idle_minutes", "");
                            } else if (!draft.idle_minutes) {
                              updateDraft("idle_minutes", "15");
                            }
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all_members">All Members</SelectItem>
                            <SelectItem value="offline_only">
                              Offline Only
                            </SelectItem>
                            <SelectItem value="offline_and_idle">
                              Offline and Idle
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {draft.target_scope === "offline_and_idle" && (
                        <div className="space-y-2">
                          <Label>Idle Minutes</Label>
                          <Input
                            type="number"
                            min={0}
                            value={draft.idle_minutes}
                            onChange={(e) =>
                              updateDraft("idle_minutes", e.target.value)
                            }
                            placeholder="15"
                          />
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label>$/hit</Label>
                        <Input
                          type="number"
                          min={0}
                          value={draft.pay_amount}
                          onChange={(e) =>
                            updateDraft("pay_amount", e.target.value)
                          }
                          placeholder="0"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Min Level</Label>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          value={draft.min_level}
                          onChange={(e) => updateDraft("min_level", e.target.value)}
                          placeholder="1"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Max Level</Label>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          value={draft.max_level}
                          onChange={(e) => updateDraft("max_level", e.target.value)}
                          placeholder="100"
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2">
                        <Label>Target Roles</Label>
                        <div className="text-xs text-muted-foreground mb-2">
                          {draft.available_roles.length} available from faction
                        </div>
                        <div className="rounded-md border border-input bg-background p-3 space-y-2 max-h-40 overflow-y-auto">
                          {draft.available_roles.length > 0 ? (
                            draft.available_roles.map((role) => (
                              <div
                                key={role}
                                className="flex items-center space-x-2"
                              >
                                <Checkbox
                                  id={`role-${role}`}
                                  checked={draft.target_roles.includes(role)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      updateTargetRoles([
                                        ...draft.target_roles,
                                        role,
                                      ]);
                                    } else {
                                      updateTargetRoles(
                                        draft.target_roles.filter(
                                          (r) => r !== role,
                                        ),
                                      );
                                    }
                                  }}
                                />
                                <Label
                                  htmlFor={`role-${role}`}
                                  className="text-sm font-normal cursor-pointer"
                                >
                                  {role}
                                </Label>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Verify a faction to load roles
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-4 rounded-lg border border-border/50 p-3 bg-background/50">
                      <div className="space-y-2">
                        <Label>Start Time (TCT / UTC)</Label>
                        <DatePickerTime
                          value={draft.start_at}
                          onChange={(v) => updateDraft("start_at", v)}
                          placeholder="Immediate"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Leave blank to start immediately. TCT is UTC time.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>End Time (TCT / UTC)</Label>
                        <DatePickerTime
                          value={draft.ends_at}
                          onChange={(v) => updateDraft("ends_at", v)}
                          placeholder="Never"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Optional. Contract auto-closes after this time.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" onClick={resetDraft}>
                        Cancel
                      </Button>
                      <Button onClick={submitContract} disabled={savingContract}>
                        {editingContractId ? (
                          <Save className="w-4 h-4 mr-2" />
                        ) : (
                          <Plus className="w-4 h-4 mr-2" />
                        )}
                        {savingContract
                          ? "Saving..."
                          : editingContractId
                            ? "Update Contract"
                            : "Create Contract"}
                      </Button>
                    </div>
                  </>
                )}
              </div>

              {/* Right Column: Contract Management */}
              <div className="space-y-5 bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs">
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-foreground">Contract Management</h3>
                  <p className="text-xs text-muted-foreground">
                    Pause, resume, close, and review contracts.
                  </p>
                </div>

                <Tabs defaultValue="active" className="w-full">
                  <TabsList>
                    <TabsTrigger value="active">
                      Active ({activeContracts.length})
                    </TabsTrigger>
                    <TabsTrigger value="past">
                      Past ({pastContracts.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="active" className="mt-4 space-y-3">
                    {activeContracts.length === 0 && (
                      <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                        No active contracts yet.
                      </div>
                    )}
                    {activeContracts.map((contract) => (
                      <div
                        key={contract.id}
                        className="rounded-lg border border-border/50 p-4 bg-background/50"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div>
                              <h4 className="font-semibold text-foreground">{contract.title}</h4>

                            </div>
                            <p className="text-xs text-muted-foreground">
                              {contract.description || "No description"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {contract.target_scope === "all_members"
                                ? "All members"
                                : contract.target_scope === "offline_only"
                                  ? "Offline only"
                                  : contract.target_scope === "offline_and_idle"
                                    ? `Offline and idle (${contract.idle_minutes}m+)`
                                    : contract.target_scope}{" "}
                              •{" "}
                              {contract.pay_amount > 0
                                ? `$${contract.pay_amount.toLocaleString()}`
                                : "No payment"}
                            </p>
                            <div className="flex flex-wrap gap-2 mt-1.5">
                              <Badge variant="secondary" className="text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                                Hits: {contract.hit_count ?? 0}
                              </Badge>
                              <Badge variant="secondary" className="text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                Payout: ${(contract.total_payout ?? 0).toLocaleString()}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex gap-2 items-center flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              className="bg-primary/5 border-primary/20 hover:bg-primary/10 hover:text-primary transition-all duration-200"
                              onClick={() => setDashboardContract(contract)}
                            >
                              <BarChart2 className="w-4 h-4 mr-1 text-primary" />
                              Dashboard
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => editContract(contract)}
                            >
                              Edit
                            </Button>
                            {contract.status === "active" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  updateContractStatus(contract.id, "paused")
                                }
                              >
                                <Pause className="w-4 h-4 mr-1" />
                                Pause
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  updateContractStatus(contract.id, "active")
                                }
                              >
                                <Play className="w-4 h-4 mr-1" />
                                Resume
                              </Button>
                            )}
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() =>
                                setContractToClose(contract)
                              }
                            >
                              <CircleOff className="w-4 h-4 mr-1" />
                              Close
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="past" className="mt-4 space-y-3">
                    {pastContracts.length === 0 && (
                      <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                        No past contracts yet.
                      </div>
                    )}
                    {pastContracts.map((contract) => (
                      <div
                        key={contract.id}
                        className="rounded-lg border border-border/50 p-4 bg-background/30"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="space-y-1">
                            <h4 className="font-semibold text-foreground">{contract.title}</h4>
                            <p className="text-xs text-muted-foreground">
                              {contract.faction_name || "Unknown faction"} •{" "}
                              {contract.status}
                            </p>
                            <div className="flex flex-wrap gap-2 mt-1">
                              <Badge variant="secondary" className="text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                                Hits: {contract.hit_count ?? 0}
                              </Badge>
                              <Badge variant="secondary" className="text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                Payout: ${(contract.total_payout ?? 0).toLocaleString()}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex gap-2 items-center">
                            <Button
                              variant="outline"
                              size="sm"
                              className="bg-primary/5 border-primary/20 hover:bg-primary/10 hover:text-primary transition-all duration-200"
                              onClick={() => setDashboardContract(contract)}
                            >
                              <BarChart2 className="w-4 h-4 mr-1 text-primary" />
                              Dashboard
                            </Button>
                            <Badge variant="secondary" className="capitalize">{contract.status}</Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        )}

        <Dialog open={!!dashboardContract} onOpenChange={(open) => !open && setDashboardContract(null)}>
          <DialogContent className="sm:max-w-5xl max-w-5xl w-full max-h-[85vh] overflow-y-auto border border-border bg-background p-6 rounded-2xl shadow-2xl">
            <DialogHeader className="pb-4 border-b border-border/60">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <DialogTitle className="text-xl font-black tracking-tight text-foreground flex items-center gap-2">
                    <BarChart2 className="w-5 h-5 text-primary" />
                    {dashboardContract?.title}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    Target Faction: <span className="font-semibold text-foreground">{dashboardContract?.faction_name || "Unknown"} [{dashboardContract?.faction_id}]</span> • Scope: <span className="capitalize">{dashboardContract?.target_scope.replace(/_/g, " ")}</span>
                  </DialogDescription>
                </div>
                {dashboardContract && (
                  <Badge variant="secondary" className="capitalize text-xs font-bold px-3 py-1 bg-primary/10 text-primary border border-primary/20">
                    {dashboardContract.status}
                  </Badge>
                )}
              </div>
            </DialogHeader>

            {loadingHits ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Loading contract metrics and hits logs...
              </div>
            ) : (
              <div className="space-y-6 pt-4">
                {/* Summary Metrics Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-2xl border border-border/60 p-4 bg-secondary/5 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Payout</p>
                      <h4 className="text-2xl font-black text-emerald-500">${dashboardSummary.totalPayout.toLocaleString()}</h4>
                    </div>
                    <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-500">
                      <DollarSign className="w-5 h-5" />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/60 p-4 bg-secondary/5 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Hits</p>
                      <h4 className="text-2xl font-black text-primary">{dashboardSummary.totalHits}</h4>
                    </div>
                    <div className="p-3 bg-primary/10 rounded-xl text-primary">
                      <Activity className="w-5 h-5" />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/60 p-4 bg-secondary/5 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active Mercs</p>
                      <h4 className="text-2xl font-black text-amber-500">{dashboardSummary.uniqueMercs}</h4>
                    </div>
                    <div className="p-3 bg-amber-500/10 rounded-xl text-amber-500">
                      <Users className="w-5 h-5" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column: Mercenary Breakdown Table */}
                  <div className="lg:col-span-1 space-y-3">
                    <div className="flex items-center gap-2 text-foreground font-bold text-sm">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      Mercenary Breakdown
                    </div>
                    <div className="rounded-xl border border-border/50 bg-background/50 overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Mercenary</TableHead>
                            <TableHead className="text-xs text-right">Hits</TableHead>
                            <TableHead className="text-xs text-right">Payout</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dashboardSummary.mercBreakdown.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-6">
                                No active mercenaries.
                              </TableCell>
                            </TableRow>
                          ) : (
                            dashboardSummary.mercBreakdown.map((merc: any) => (
                              <TableRow key={merc.discordId}>
                                <TableCell className="font-medium text-xs">
                                  <div className="truncate max-w-[120px]" title={merc.name}>
                                    {merc.name}
                                  </div>
                                  <span className="text-[10px] text-muted-foreground">ID: {merc.tornId}</span>
                                </TableCell>
                                <TableCell className="text-xs text-right font-semibold">{merc.hits}</TableCell>
                                <TableCell className="text-xs text-right font-black text-emerald-500">${merc.payout.toLocaleString()}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  {/* Right Column: Verified Hits Log Table */}
                  <div className="lg:col-span-2 space-y-3">
                    <div className="flex items-center gap-2 text-foreground font-bold text-sm">
                      <Activity className="w-4 h-4 text-muted-foreground" />
                      Hits History
                    </div>
                    <div className="rounded-xl border border-border/50 bg-background/50 overflow-hidden max-h-[350px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Time (TCT)</TableHead>
                            <TableHead className="text-xs">Attacker</TableHead>
                            <TableHead className="text-xs">Defender</TableHead>
                            <TableHead className="text-xs">Type</TableHead>
                            <TableHead className="text-xs text-right">Payout</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dashboardHits.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-12">
                                No hits recorded yet.
                              </TableCell>
                            </TableRow>
                          ) : (
                            dashboardHits.map((hit: any) => {
                              const dateObj = new Date(hit.occurred_at);
                              const tctTime = dateObj.toISOString().replace("T", " ").substring(0, 16);
                              const isInvalid = hit.result === "invalid_type";
                              return (
                                <TableRow key={hit.id}>
                                  <TableCell className="text-[11px] text-muted-foreground font-mono">{tctTime}</TableCell>
                                  <TableCell className="text-xs font-medium">{hit.attacker_name || hit.merc_name}</TableCell>
                                  <TableCell className="text-xs">{hit.defender_name} <span className="text-[10px] text-muted-foreground">[{hit.defender_torn_id}]</span></TableCell>
                                  <TableCell className="text-xs">
                                    {isInvalid ? (
                                      <Badge className="text-[10px] font-normal px-2 py-0.5 bg-rose-500/10 text-rose-500 border border-rose-500/20 hover:bg-rose-500/20">
                                        Invalid: {hit.attack_type || "Attack"}
                                      </Badge>
                                    ) : (
                                      <Badge variant="secondary" className="text-[10px] font-normal px-2 py-0.5">
                                        {hit.attack_type || "Attack"}
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className={`text-xs text-right font-semibold ${isInvalid ? 'text-muted-foreground/60 line-through' : 'text-emerald-500'}`}>
                                    ${(hit.payout_amount || 0).toLocaleString()}
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Confirm Close Contract Dialog */}
        <Dialog open={!!contractToClose} onOpenChange={(open) => !open && setContractToClose(null)}>
          <DialogContent className="sm:max-w-md border border-border bg-background p-6 rounded-2xl shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-bold text-foreground">
                Confirm Close Contract
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground pt-1">
                Are you sure you want to close the contract <strong>"{contractToClose?.title}"</strong>? This will generate the final completion payment report and post it to Discord. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => setContractToClose(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  if (contractToClose) {
                    const cId = contractToClose.id;
                    setContractToClose(null);
                    await updateContractStatus(cId, "completed");
                  }
                }}
              >
                Close Contract
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  },
);

MercenaryConfig.displayName = "MercenaryConfig";
