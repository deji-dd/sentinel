import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  forwardRef,
} from "react";
import { LoadingScreen } from "@/components/loading-screen";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { toast } from "sonner";
import { fetchWithFallback } from "@/lib/api-base";
import {
  Briefcase,
  ShieldAlert,
  Crosshair,
  Pause,
  Play,
  CircleOff,
  Save,
  Plus,
} from "lucide-react";

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
  auto_finish_on_war_end: boolean;
  min_level: string;
  max_level: string;
  require_faction_active_war: boolean;
  require_faction_upcoming_war: boolean;
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
  auto_finish_on_war_end: true,
  min_level: "",
  max_level: "",
  require_faction_active_war: false,
  require_faction_upcoming_war: true,
  target_roles: [],
};

export const MercenaryConfig = forwardRef(
  (
    {
      sessionToken,
      initialData,
      onDirtyChange,
    }: {
      sessionToken: string;
      initialData?: any;
      onDirtyChange?: (isDirty: boolean) => void;
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

        setSettings(payload.settings);
        setSettingsBaseline(payload.settings);
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
          start_at: draft.start_at || null,
          ends_at: draft.ends_at || null,
          faction_id: Number(draft.faction_id),
          target_scope: draft.target_scope,
          idle_minutes:
            draft.target_scope === "offline_and_idle" && draft.idle_minutes
              ? Number(draft.idle_minutes)
              : null,
          auto_finish_on_war_end: draft.auto_finish_on_war_end,
          min_level: draft.min_level ? Number(draft.min_level) : null,
          max_level: draft.max_level ? Number(draft.max_level) : null,
          require_faction_active_war: draft.require_faction_active_war,
          require_faction_upcoming_war: draft.require_faction_upcoming_war,
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
        start_at: contract.start_at || "",
        ends_at: contract.ends_at || "",
        faction_id: contract.faction_id ? String(contract.faction_id) : "",
        faction_name: contract.faction_name || "",
        available_roles: [],
        target_scope: contract.target_scope || "offline_and_idle",
        idle_minutes: contract.idle_minutes
          ? String(contract.idle_minutes)
          : "15",
        auto_finish_on_war_end: contract.auto_finish_on_war_end === 1,
        min_level: contract.min_level ? String(contract.min_level) : "",
        max_level: contract.max_level ? String(contract.max_level) : "",
        require_faction_active_war:
          contract.require_faction_no_active_war === 1,
        require_faction_upcoming_war:
          contract.require_faction_no_upcoming_war === 1,
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
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary mb-1">
              <Briefcase className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">
                Module Hub
              </span>
            </div>
            <CardTitle>Mercenary Module Settings</CardTitle>
            <CardDescription>
              Configure module-level channels and defaults for contract
              execution.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
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
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary mb-1">
              <Crosshair className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">
                Dibs System
              </span>
            </div>
            <CardTitle>Dibs Configuration</CardTitle>
            <CardDescription>
              Configure the dibs system for war-time mercenary coordination.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              <div className="space-y-2">
                <Label>Max Active Dibs Per Person</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={settings.max_active_dibs_per_person || 5}
                  onChange={(e) =>
                    setSettings((current) =>
                      current
                        ? {
                            ...current,
                            max_active_dibs_per_person: Number(e.target.value),
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
                  value={settings.dibs_remaining_minutes || 15}
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
                  Only targets with this much time left in hospital show in dibs
                  list
                </p>
              </div>

              <div className="flex items-center justify-between">
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
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary mb-1">
              <Crosshair className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">
                Contracts
              </span>
            </div>
            <CardTitle>
              {editingContractId ? "Edit Contract" : "Create Contract"}
            </CardTitle>
            <CardDescription>
              Contracts require faction verification and war-state checks before
              they can be saved.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Faction ID Verification Gate */}
            {!draft.faction_name ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex gap-2 items-center">
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
                <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-200 flex gap-2 items-center">
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
                      value={draft.description}
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-border/50 p-3 bg-background/50">
                  <div className="flex items-center justify-between">
                    <Label>Auto-finish on war end</Label>
                    <Switch
                      checked={draft.auto_finish_on_war_end}
                      onCheckedChange={(v) =>
                        updateDraft("auto_finish_on_war_end", v)
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Require active war</Label>
                    <Switch
                      checked={draft.require_faction_active_war}
                      onCheckedChange={(v) =>
                        updateDraft("require_faction_active_war", v)
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Require upcoming war</Label>
                    <Switch
                      checked={draft.require_faction_upcoming_war}
                      onCheckedChange={(v) =>
                        updateDraft("require_faction_upcoming_war", v)
                      }
                    />
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
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Contract Management</CardTitle>
            <CardDescription>
              Pause, resume, close, and review contracts.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                          <h4 className="font-semibold">{contract.title}</h4>
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
                      </div>
                      <div className="flex gap-2">
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
                            updateContractStatus(contract.id, "completed")
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
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h4 className="font-semibold">{contract.title}</h4>
                        <p className="text-xs text-muted-foreground">
                          {contract.faction_name || "Unknown faction"} •{" "}
                          {contract.status}
                        </p>
                      </div>
                      <Badge variant="secondary">Closed</Badge>
                    </div>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    );
  },
);

MercenaryConfig.displayName = "MercenaryConfig";
