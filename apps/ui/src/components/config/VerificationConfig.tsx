import { useState, useEffect, forwardRef, useImperativeHandle, useMemo, useCallback } from "react";
import { LoadingScreen, TacticalLoader } from "@/components/loading-screen";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Shield,
  Users,
  Plus,
  Trash2,
  Search,
  Settings2,
  Hash,
  ChevronDown,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FactionRole {
  id: string;
  faction_id: number;
  faction_name: string | null;
  member_role_ids: string[];
  leader_role_ids: string[];
  enabled: number;
}

interface GuildItem {
  id: string;
  name: string;
}

export const VerificationConfig = forwardRef(
  (
    {
      sessionToken,
      initialData,
      onConfigUpdate,
      onDirtyChange,
    }: {
      sessionToken: string;
      initialData?: any;
      onConfigUpdate?: (data: any) => void;
      onDirtyChange?: (isDirty: boolean) => void;
    },
    ref,
  ) => {
    const [loading, setLoading] = useState(!initialData);
    const [config, setConfig] = useState<any>(initialData || null);
    const [factionRoles, setFactionRoles] = useState<FactionRole[]>([]);

    // Settings State
    const [autoVerify, setAutoVerify] = useState(initialData?.auto_verify === 1);
    const [nicknameTemplate, setNicknameTemplate] = useState(initialData?.nickname_template || "{name}#{id}");
    const [verifiedRoleId, setVerifiedRoleId] = useState(initialData?.verified_role_id || "");
    const [verifiedRoleIds, setVerifiedRoleIds] = useState<string[]>(Array.isArray(initialData?.verified_role_ids) ? initialData.verified_role_ids : []);
    const [factionListChannelId, setFactionListChannelId] = useState(initialData?.faction_list_channel_id || "");

    // Faction Role Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRole, setEditingRole] = useState<FactionRole | null>(null);
    const [modalFactionId, setModalFactionId] = useState("");
    const [modalFactionName, setModalFactionName] = useState("");
    const [modalMemberRoles, setModalMemberRoles] = useState<string[]>([]);
    const [modalLeaderRoles, setModalLeaderRoles] = useState<string[]>([]);
    const [modalEnabled, setModalEnabled] = useState(true);
    const [roleSearch, setRoleSearch] = useState("");
    const [isFetchingFaction, setIsFetchingFaction] = useState(false);
    const [isFactionValidated, setIsFactionValidated] = useState(false);

    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const fetchConfig = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
        const res = await fetch(`${API_BASE}/api/config`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!res.ok) throw new Error("Failed to fetch config");
        const configData = await res.json();
        setConfig(configData);

        // Pre-fill state
        setAutoVerify(configData.auto_verify === 1);
        setNicknameTemplate(configData.nickname_template || "{name}#{id}");
        setVerifiedRoleId(configData.verified_role_id || "none");
        setVerifiedRoleIds(configData.verified_role_ids || []);
        setFactionListChannelId(configData.faction_list_channel_id || "none");

        if (onConfigUpdate) onConfigUpdate(configData);
      } catch (err) {
        toast.error("Failed to load configuration");
      } finally {
        if (!silent) setLoading(false);
      }
    };

    const fetchFactionRoles = useCallback(async () => {
      try {
        const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
        const res = await fetch(`${API_BASE}/api/config/faction-roles`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!res.ok) throw new Error("Failed to fetch faction roles");
        const data = await res.json();
        setFactionRoles(data);
      } catch (err) {
        toast.error("Failed to load faction role mappings");
      } finally {
        // No-op
      }
    }, [sessionToken]);

    useEffect(() => {
      if (!initialData) {
        fetchConfig();
      }
      fetchFactionRoles();
    }, [sessionToken, fetchFactionRoles, initialData]);

    // Derived data memoization
    const availableRoles = useMemo(() => config?.roles || [], [config?.roles]);
    const availableChannels = useMemo(() => config?.channels || [], [config?.channels]);

    const filteredRoles = useMemo(() => {
      const search = roleSearch.toLowerCase();
      if (!search) return availableRoles;
      return availableRoles.filter((r: GuildItem) =>
        r.name.toLowerCase().includes(search) || r.id.includes(search)
      );
    }, [availableRoles, roleSearch]);

    const sortedFactionRoles = useMemo(() => {
      return [...factionRoles].sort((a, b) =>
        (a.faction_name || "").localeCompare(b.faction_name || "")
      );
    }, [factionRoles]);

    const handleFetchFaction = async () => {
      const factionId = modalFactionId.trim();
      if (!factionId || isNaN(Number(factionId))) {
        toast.error("Invalid Faction ID entered");
        return;
      }

      // Guard check: is it already mapped?
      const isDuplicate = factionRoles.some(
        (fr) =>
          fr.faction_id === Number(factionId) && fr.id !== editingRole?.id,
      );
      if (isDuplicate) {
        toast.error(`Faction ${factionId} is already mapped in this guild.`);
        return;
      }

      setIsFetchingFaction(true);
      try {
        const API_BASE =
          import.meta.env.VITE_API_URL || "http://localhost:3001";
        const res = await fetch(
          `${API_BASE}/api/config/faction-lookup/${factionId}`,
          {
            headers: { Authorization: `Bearer ${sessionToken}` },
          },
        );
        if (res.ok) {
          const data = await res.json();
          if (data && data.name) {
            setModalFactionName(data.name);
            setIsFactionValidated(true);
            toast.success(`Faction Resolved: ${data.name}`, {
              description: `[${data.tag}] • ${data.members} Members • ${data.respect.toLocaleString()} Respect • ${data.rank || "No Rank"}`,
            });
          }
        } else {
          const errData = await res.json();
          toast.error(errData.error || "Failed to resolve faction details");
        }
      } catch (err) {
        toast.error("Network error while verifying faction");
      } finally {
        setIsFetchingFaction(false);
      }
    };

    // Track dirty state
    useEffect(() => {
      if (!config) return;

      const checkDirty = () => {
        const isAutoVerifyChanged = (autoVerify ? 1 : 0) !== config.auto_verify;
        const isNicknameChanged =
          nicknameTemplate !== (config.nickname_template || "{name}#{id}");
        const isVerifiedRoleChanged =
          (verifiedRoleId === "none" ? "" : verifiedRoleId) !==
          (config.verified_role_id || "");

        const isVerifiedRolesChanged = JSON.stringify([...verifiedRoleIds].sort()) !== JSON.stringify([...(config.verified_role_ids || [])].sort());

        const isFactionChannelChanged =
          (factionListChannelId === "none" ? "" : factionListChannelId) !==
          (config.faction_list_channel_id || "");

        onDirtyChange?.(
          isAutoVerifyChanged ||
          isNicknameChanged ||
          isVerifiedRoleChanged ||
          isVerifiedRolesChanged ||
          isFactionChannelChanged,
        );
      };

      const handler = setTimeout(checkDirty, 100);
      return () => clearTimeout(handler);
    }, [
      autoVerify,
      nicknameTemplate,
      verifiedRoleId,
      verifiedRoleIds,
      factionListChannelId,
      config,
      onDirtyChange,
    ]);

    const handleSaveSettings = async () => {
      try {
        const API_BASE =
          import.meta.env.VITE_API_URL || "http://localhost:3001";
        const res = await fetch(`${API_BASE}/api/config`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            auto_verify: autoVerify,
            nickname_template: nicknameTemplate,
            verified_role_id: verifiedRoleId === "none" ? null : verifiedRoleId,
            verified_role_ids: verifiedRoleIds,
            faction_list_channel_id:
              factionListChannelId === "none" ? null : factionListChannelId,
          }),
        });

        if (!res.ok) throw new Error("Update failed");
        toast.success("Verification settings updated");
        await fetchConfig(true); // Only refetch config, not faction roles
        return true;
      } catch (err) {
        toast.error("Failed to save settings");
        return false;
      }
    };

    useImperativeHandle(ref, () => ({
      save: handleSaveSettings,
    }));

    const handleOpenModal = (role: FactionRole | null = null) => {
      if (role) {
        setEditingRole(role);
        setModalFactionId(role.faction_id.toString());
        setModalFactionName(role.faction_name || "");
        setModalMemberRoles(role.member_role_ids);
        setModalLeaderRoles(role.leader_role_ids);
        setModalEnabled(role.enabled === 1);
        setIsFactionValidated(true);
      } else {
        setEditingRole(null);
        setModalFactionId("");
        setModalFactionName("");
        setModalMemberRoles([]);
        setModalLeaderRoles([]);
        setModalEnabled(true);
        setIsFactionValidated(false);
      }
      setIsModalOpen(true);
    };

    const handleSaveFactionRole = async () => {
      if (!modalFactionId) {
        toast.error("Faction ID is required");
        return;
      }

      try {
        const API_BASE =
          import.meta.env.VITE_API_URL || "http://localhost:3001";
        const res = await fetch(`${API_BASE}/api/config/faction-roles`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            id: editingRole?.id,
            faction_id: modalFactionId,
            faction_name: modalFactionName,
            member_role_ids: modalMemberRoles,
            leader_role_ids: modalLeaderRoles,
            enabled: modalEnabled,
          }),
        });

        if (!res.ok) throw new Error("Save failed");
        toast.success(
          editingRole ? "Faction role updated" : "Faction role added",
        );
        setIsModalOpen(false);
        fetchFactionRoles(); // Only refetch faction roles
      } catch (err) {
        toast.error("Failed to save faction role");
      }
    };

    const handleDeleteFactionRole = async (id: string) => {
      try {
        const API_BASE =
          import.meta.env.VITE_API_URL || "http://localhost:3001";
        const res = await fetch(`${API_BASE}/api/config/faction-roles/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });

        if (!res.ok) throw new Error("Delete failed");
        toast.success("Faction role deleted");
        setDeleteConfirm(null);
        fetchFactionRoles(); // Only refetch faction roles
      } catch (err) {
        toast.error("Failed to delete faction role");
      }
    };

    const toggleModalRole = (roleId: string, type: "member" | "leader") => {
      if (type === "member") {
        setModalMemberRoles((prev) =>
          prev.includes(roleId)
            ? prev.filter((id) => id !== roleId)
            : [...prev, roleId],
        );
      } else {
        setModalLeaderRoles((prev) =>
          prev.includes(roleId)
            ? prev.filter((id) => id !== roleId)
            : [...prev, roleId],
        );
      }
    };

    if (loading)
      return (
        <LoadingScreen
          fullScreen={false}
          subMessage="Loading Verification Config"
        />
      );

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Core Settings */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm transition-all duration-300">
            <CardHeader>
              <div className="flex items-center gap-2 text-primary mb-1">
                <Shield className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">
                  Core
                </span>
              </div>
              <CardTitle className="text-foreground">
                Verification Engine
              </CardTitle>
              <CardDescription className="text-muted-foreground/80">
                Configure how members are verified and identified within the
                guild.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-2xl bg-secondary/5 border border-border/50">
                <div className="space-y-0.5">
                  <Label className="text-sm font-bold text-foreground">
                    Auto-Verification
                  </Label>
                  <p className="text-[10px] text-muted-foreground uppercase font-medium tracking-tight">
                    Process members on join
                  </p>
                </div>
                <Switch
                  checked={autoVerify}
                  onCheckedChange={setAutoVerify}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-wider font-black text-muted-foreground">
                  Nickname Template
                </Label>
                <Input
                  value={nicknameTemplate}
                  onChange={(e) => setNicknameTemplate(e.target.value)}
                  placeholder="{name}#{id}"
                  className="h-10 px-3 rounded-xl bg-background/50 border-border/50 focus-visible:ring-primary/20 text-foreground font-mono"
                />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Available placeholders:{" "}
                  <code className="text-primary font-bold">{"{name}"}</code>,{" "}
                  <code className="text-primary font-bold">{"{id}"}</code>,{" "}
                  <code className="text-primary font-bold">{"{tag}"}</code>
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-[10px] uppercase tracking-wider font-black text-muted-foreground">
                    General Verified Roles
                  </Label>
                  {verifiedRoleIds.length > 0 && (
                    <Badge variant="secondary" className="h-5 text-[9px] bg-primary/10 text-primary border-primary/20 font-black uppercase tracking-widest px-2 animate-in fade-in zoom-in duration-300">
                      Active: {verifiedRoleIds.length} Roles
                    </Badge>
                  )}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between h-11 px-4 rounded-xl bg-background/50 border-border/50 hover:bg-background/80 hover:border-primary/30 transition-all group"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Shield className="w-4 h-4 text-primary opacity-50 group-hover:opacity-100 transition-opacity" />
                        <span className="truncate font-bold text-sm">
                          {verifiedRoleIds.length === 0
                            ? "Select Verified Roles"
                            : verifiedRoleIds.map(id => availableRoles.find((r: GuildItem) => r.id === id)?.name).filter(Boolean).join(", ")
                          }
                        </span>
                      </div>
                      <ChevronDown className="w-4 h-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) max-h-[300px] overflow-y-auto custom-scrollbar p-2" align="start">
                    <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest opacity-50 px-2 py-1.5">Available Roles</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={verifiedRoleIds.length === 0}
                      onCheckedChange={(checked) => {
                        if (checked) setVerifiedRoleIds([]);
                      }}
                      className="rounded-lg font-bold py-2 focus:bg-primary/10 transition-colors cursor-pointer italic text-muted-foreground"
                    >
                      None (Clear All)
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    {availableRoles.filter((r: GuildItem) => r.id !== "none").map((r: GuildItem) => (
                      <DropdownMenuCheckboxItem
                        key={r.id}
                        checked={verifiedRoleIds.includes(r.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setVerifiedRoleIds([...verifiedRoleIds, r.id]);
                          } else {
                            setVerifiedRoleIds(verifiedRoleIds.filter(id => id !== r.id));
                          }
                        }}
                        className="rounded-lg font-bold py-2 focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer"
                      >
                        {r.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                    {availableRoles.length === 0 && (
                      <div className="py-6 text-center text-xs text-muted-foreground italic">No roles available</div>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                <p className="text-[10px] text-muted-foreground">
                  These roles are granted to all successfully verified users
                  regardless of faction. Select multiple to support multiple roles.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-[10px] uppercase tracking-wider font-black text-muted-foreground">
                    Faction List Channel
                  </Label>

                </div>

                <Select
                  value={factionListChannelId}
                  onValueChange={setFactionListChannelId}
                >
                  <SelectTrigger className="w-full h-11 px-4 rounded-xl bg-background/50 border-border/50 hover:bg-background/80 hover:border-primary/30 transition-all group font-bold">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Hash className="w-4 h-4 text-primary opacity-50 group-hover:opacity-100 transition-opacity" />
                      <SelectValue placeholder="Select Channel" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px] overflow-y-auto custom-scrollbar p-2">
                    <SelectItem value="none" className="italic font-bold text-muted-foreground rounded-lg">None (Disabled)</SelectItem>
                    {availableChannels.map((c: GuildItem) => (
                      <SelectItem key={c.id} value={c.id} className="font-bold rounded-lg focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer">
                        <span className="opacity-40 mr-1">#</span>{c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <p className="text-[10px] text-muted-foreground">
                  Channel where the automated faction role mapping overview is
                  published.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Faction Roles Section */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <div className="flex items-center gap-2 text-primary mb-1">
                  <Users className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">
                    Assignments
                  </span>
                </div>
                <CardTitle className="text-foreground">
                  Faction Role Mappings
                </CardTitle>
                <CardDescription className="text-muted-foreground/80">
                  Map specific factions to Discord roles with granular
                  member/leader distinction.
                </CardDescription>
              </div>
              <Button
                onClick={() => handleOpenModal()}
                size="sm"
              >
                <Plus /> Add
              </Button>
            </CardHeader>
            <CardContent>
              <div className="max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                <div className="grid grid-cols-1 gap-3 pt-2 pb-2">
                  {sortedFactionRoles.map((fr) => (
                    <div
                      key={fr.id}
                      className={cn(
                        "group relative flex flex-col p-4 rounded-3xl border transition-all duration-300",
                        fr.enabled
                          ? "bg-secondary/10 border-border/50 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 hover:bg-secondary/20 hover:-translate-y-1"
                          : "bg-destructive/5 border-destructive/20 opacity-70",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3 h-7">
                        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                          <div
                            className={cn(
                              "w-2 h-2 rounded-full shrink-0",
                              fr.enabled
                                ? "bg-emerald-500 animate-pulse"
                                : "bg-destructive",
                            )}
                          />
                          <h4 className="font-bold text-sm text-foreground truncate">
                            {fr.faction_name || `Faction ${fr.faction_id}`}
                          </h4>
                          <Badge
                            variant="outline"
                            className="text-[8px] h-3 px-1 border-muted-foreground/20 font-mono text-muted-foreground"
                          >
                            {fr.faction_id}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-lg hover:bg-primary/10 hover:text-primary cursor-pointer"
                            onClick={() => handleOpenModal(fr)}
                          >
                            <Settings2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-lg hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                            onClick={() => setDeleteConfirm(fr.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {fr.member_role_ids.map((rid) => {
                            const role = availableRoles.find(
                              (r: GuildItem) => r.id === rid,
                            );
                            return (
                              <Badge
                                key={rid}
                                variant="secondary"
                                className="text-[9px] bg-primary/5 text-primary border-primary/10 py-0"
                              >
                                {role?.name || "Unknown Role"}
                              </Badge>
                            );
                          })}
                          {fr.member_role_ids.length === 0 && (
                            <span className="text-[10px] text-muted-foreground italic">
                              No member roles
                            </span>
                          )}
                        </div>
                        {fr.leader_role_ids.length > 0 && (
                          <div className="flex flex-wrap gap-1 border-t border-border/30 pt-2">
                            <span className="text-[9px] font-black text-primary/40 uppercase tracking-tighter mr-1 self-center">
                              Leaders
                            </span>
                            {fr.leader_role_ids.map((rid) => {
                              const role = availableRoles.find(
                                (r: GuildItem) => r.id === rid,
                              );
                              return (
                                <Badge
                                  key={rid}
                                  variant="outline"
                                  className="text-[9px] text-primary border-primary/30 py-0 font-bold uppercase"
                                >
                                  {role?.name || "Unknown Role"}
                                </Badge>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {factionRoles.length === 0 && (
                    <div className="text-center py-12 border border-dashed border-border/50 rounded-3xl space-y-3 col-span-full">
                      <div className="w-12 h-12 rounded-2xl bg-secondary/50 flex items-center justify-center mx-auto opacity-20">
                        <Users className="w-6 h-6" />
                      </div>
                      <p className="text-xs text-muted-foreground font-medium">
                        No faction mappings configured.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Faction Role Dialog */}
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="sm:max-w-5xl w-full gap-0 overflow-hidden border-border/50 shadow-2xl">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-2xl font-black uppercase tracking-tight">
                    {editingRole ? "Configure Mapping" : "Initialize Mapping"}
                  </DialogTitle>
                  <DialogDescription className="text-xs font-medium italic opacity-70">
                    Sync Discord roles with Torn faction membership states.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] bg-background">
              {/* Configuration Panel */}
              <div className="p-8 border-r border-border/50 space-y-8 bg-secondary/5">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest ml-1">
                      Faction Identifier
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g. 1234"
                        value={modalFactionId}
                        disabled={!!editingRole}
                        onChange={(e) => {
                          setModalFactionId(e.target.value);
                          setIsFactionValidated(false);
                        }}
                        className="h-11 rounded-xl border-border/50 bg-background font-mono text-center text-lg focus-visible:ring-primary/20 flex-1 disabled:opacity-50"
                      />
                      <Button
                        onClick={handleFetchFaction}
                        disabled={isFetchingFaction || !modalFactionId || !!editingRole}
                        className={cn(
                          "h-11 px-6 rounded-xl font-black uppercase tracking-tight transition-all",
                          isFactionValidated && !editingRole
                            ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                            : "bg-primary hover:bg-primary/90",
                          editingRole && "hidden"
                        )}
                      >
                        {isFetchingFaction ? (
                          <TacticalLoader
                            size="18"
                            stroke="3"
                            color="white"
                          />
                        ) : isFactionValidated ? (
                          <Users className="w-4 h-4" />
                        ) : (
                          "Verify"
                        )}
                      </Button>
                    </div>
                    <p className="text-[9px] text-muted-foreground italic ml-1">
                      {isFactionValidated ? "Faction identity confirmed." : "Initial verification required."}
                    </p>
                  </div>

                  <div className={cn("space-y-6 transition-all duration-300", !isFactionValidated && "opacity-40 pointer-events-none grayscale")}>
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest ml-1">
                        Faction Name
                      </Label>
                      <div className="relative">
                        <Input
                          placeholder="Unresolved Faction"
                          value={modalFactionName}
                          readOnly
                          disabled
                          className="h-11 rounded-xl border-border/50 bg-secondary/20 font-bold opacity-80 cursor-not-allowed"
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 ml-1">
                        Automatically resolved from Faction ID above.
                      </p>
                    </div>

                    <div className="pt-4">
                      <div className="flex items-center justify-between p-4 rounded-2xl bg-background border border-border/50 shadow-sm">
                        <div className="space-y-0.5">
                          <Label className="text-xs font-black uppercase tracking-tight">Active State</Label>
                          <p className="text-[10px] text-muted-foreground leading-none">Enable automated sync</p>
                        </div>
                        <Switch
                          checked={modalEnabled}
                          onCheckedChange={setModalEnabled}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-dashed border-border/50 bg-secondary/5 space-y-2">
                  <div className="flex items-center gap-2 text-primary opacity-50">
                    <Shield className="w-3.5 h-3.5" />
                    <span className="text-[9px] font-black uppercase tracking-widest">Selected Roles</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[9px] bg-emerald-500/5 text-emerald-600 border-emerald-500/20 font-bold">
                      {modalMemberRoles.length} MEMBERS
                    </Badge>
                    <Badge variant="outline" className="text-[9px] bg-amber-500/5 text-amber-600 border-amber-500/20 font-bold">
                      {modalLeaderRoles.length} LEADERS
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Roles Panel */}
              <div className={cn("flex flex-col h-[500px] transition-all duration-300", !isFactionValidated && "opacity-40 pointer-events-none grayscale")}>
                <div className="p-6 border-b border-border/50 bg-secondary/5 flex items-center justify-between gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/30" />
                    <Input
                      placeholder="Search available Discord roles..."
                      value={roleSearch}
                      onChange={(e) => setRoleSearch(e.target.value)}
                      className="pl-10 h-10 rounded-xl border-border/50 bg-background text-sm"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                  <div className="grid grid-cols-1 gap-2">
                    {filteredRoles.map((r: GuildItem) => {
                      const isMember = modalMemberRoles.includes(r.id);
                      const isLeader = modalLeaderRoles.includes(r.id);

                      return (
                        <div key={r.id} className={cn(
                          "flex items-center justify-between p-3 rounded-xl border transition-all duration-200 group",
                          isMember || isLeader
                            ? "bg-primary/5 border-primary/20 shadow-sm"
                            : "bg-background border-border/50 hover:border-border"
                        )}>
                          <div className="flex flex-col">
                            <span className={cn(
                              "text-sm font-bold truncate max-w-[200px] transition-colors",
                              isMember || isLeader ? "text-primary" : "text-foreground/70"
                            )}>
                              {r.name}
                            </span>
                            <span className="text-[9px] font-mono text-muted-foreground opacity-50">
                              {r.id === "none" ? "System Placeholder" : `RID: ${r.id.slice(0, 12)}...`}
                            </span>
                          </div>

                          <div className="flex gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant={isMember ? "default" : "outline"}
                              className={cn(
                                "h-8 text-[9px] font-black rounded-lg transition-all px-3",
                                isMember ? "bg-emerald-500 hover:bg-emerald-600 border-transparent shadow-lg shadow-emerald-500/20" : "bg-background hover:bg-emerald-50/50"
                              )}
                              onClick={() => toggleModalRole(r.id, "member")}
                            >
                              MEMBER
                            </Button>
                            <Button
                              size="sm"
                              variant={isLeader ? "default" : "outline"}
                              className={cn(
                                "h-8 text-[9px] font-black rounded-lg transition-all px-3",
                                isLeader ? "bg-amber-500 hover:bg-amber-600 border-transparent shadow-lg shadow-amber-500/20" : "bg-background hover:bg-amber-50/50"
                              )}
                              onClick={() => toggleModalRole(r.id, "leader")}
                            >
                              LEADER
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                size={"lg"}
                onClick={() => setIsModalOpen(false)}
              >
                Discard Changes
              </Button>
              <Button
                onClick={handleSaveFactionRole}
                size="lg"
                disabled={!isFactionValidated}

              >
                Execute Mapping
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog
          open={!!deleteConfirm}
          onOpenChange={(open) => !open && setDeleteConfirm(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Erase Mapping?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the faction-to-role association.
                Automation for this faction will cease immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                Abort
              </AlertDialogCancel>
              <AlertDialogAction
                variant={"destructive"}
                onClick={() =>
                  deleteConfirm && handleDeleteFactionRole(deleteConfirm)
                }
              >
                Confirm Erasure
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  },
);
