import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { LoadingScreen, TacticalLoader } from "@/components/loading-screen";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Key, Trash2, Plus, Hash, ChevronDown } from "lucide-react";
import { toast } from "sonner";
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

interface ApiKey {
  id: string;
  provided_by: string;
  provided_by_name?: string;
  is_primary: number;
  invalid_count: number;
  created_at: string;
}

interface GuildItem {
  id: string;
  name: string;
}

export const AdminConfig = forwardRef(({
  sessionToken,
  initialData,
  onConfigUpdate,
  onDirtyChange
}: {
  sessionToken: string;
  initialData?: any;
  onConfigUpdate?: (data: any) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}, ref) => {
  const [loading, setLoading] = useState(!initialData);
  const [addingKey, setAddingKey] = useState(false);
  const [config, setConfig] = useState<any>(initialData || null);
  const [newKey, setNewKey] = useState("");
  const [logChannelId, setLogChannelId] = useState(initialData?.log_channel_id || "");
  const [selectedAdminRoles, setSelectedAdminRoles] = useState<string[]>(Array.isArray(initialData?.admin_role_ids) ? initialData.admin_role_ids : []);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; isLast: boolean } | null>(null);

  const fetchConfig = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
      const res = await fetch(`${API_BASE}/api/config`, {
        headers: { Authorization: `Bearer ${sessionToken}` }
      });
      if (!res.ok) throw new Error("Failed to fetch config");
      const data = await res.json();
      setConfig(data);
      setLogChannelId(data.log_channel_id || "");
      setSelectedAdminRoles(Array.isArray(data.admin_role_ids) ? data.admin_role_ids : []);
      if (onConfigUpdate) onConfigUpdate(data);
    } catch (err) {
      toast.error("Failed to load configuration");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialData) {
      fetchConfig();
    }
  }, [sessionToken, initialData]);

  // Track dirty state
  useEffect(() => {
    if (!config) return;
    const initialRoles = Array.isArray(config.admin_role_ids) ? [...config.admin_role_ids].sort() : [];
    const currentRoles = [...selectedAdminRoles].sort();

    const rolesChanged = JSON.stringify(initialRoles) !== JSON.stringify(currentRoles);
    const channelChanged = (logChannelId || "") !== (config.log_channel_id || "");

    onDirtyChange?.(rolesChanged || channelChanged);
  }, [selectedAdminRoles, logChannelId, config, onDirtyChange]);

  const handleSaveSettings = async () => {
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
      const res = await fetch(`${API_BASE}/api/config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          log_channel_id: logChannelId,
          admin_role_ids: selectedAdminRoles
        })
      });

      if (!res.ok) throw new Error("Update failed");
      toast.success("Settings updated successfully");
      await fetchConfig(true);
      return true;
    } catch (err) {
      toast.error("Failed to save settings");
      return false;
    }
  };

  useImperativeHandle(ref, () => ({
    save: handleSaveSettings
  }));

  const handleAddKey = async () => {
    const trimmedKey = newKey.trim();
    if (!trimmedKey) return;
    setAddingKey(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
      const res = await fetch(`${API_BASE}/api/config/api-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          api_key: trimmedKey,
          is_primary: config?.api_keys?.length === 0 ? 1 : 0
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add key");
      }

      setNewKey("");
      toast.success("API key added");
      fetchConfig(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to add API key");
    } finally {
      setAddingKey(false);
    }
  };

  const performDeleteKey = async (id: string) => {
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
      const res = await fetch(`${API_BASE}/api/config/api-keys`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({ api_key_id: id })
      });

      if (!res.ok) throw new Error("Delete failed");
      toast.success("API key removed");
      fetchConfig(true);
    } catch (err) {
      toast.error("Failed to remove API key");
    } finally {
      setDeleteConfirm(null);
    }
  };

  const toggleRole = (roleId: string) => {
    setSelectedAdminRoles(prev =>
      prev.includes(roleId) ? prev.filter(id => id !== roleId) : [...prev, roleId]
    );
  };

  if (loading) return (
    <LoadingScreen 
      fullScreen={false} 
      subMessage="Loading Admin Config" 
    />
  );

  const availableRoles = config?.roles || [];
  const availableChannels = config?.channels || [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* API Keys Section */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-xl transition-shadow duration-300">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary mb-1">
              <Key className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">Security</span>
            </div>
            <CardTitle className="text-foreground">API Key Management</CardTitle>
            <CardDescription className="text-muted-foreground/80">
              Manage Torn API keys for guild operations. Keys are encrypted at rest.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Enter Torn API Key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="font-mono bg-background/50 border-border/50 focus-visible:ring-primary/20 text-foreground"
                disabled={addingKey}
              />
              <Button onClick={handleAddKey} size="icon" className="shrink-0 bg-primary hover:bg-primary/90 cursor-pointer" disabled={addingKey || !newKey}>
                {addingKey ? (
                  <TacticalLoader
                    size="16"
                    stroke="3"
                    color="white"
                  />
                ) : <Plus className="w-4 h-4" />}
              </Button>
            </div>

            <div className="max-h-[300px] overflow-y-auto pr-2 space-y-3 custom-scrollbar">
              {config?.api_keys?.map((key: ApiKey) => (
                <div key={key.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-secondary/5 hover:bg-secondary/10 transition-colors group">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-foreground/60 leading-none">••••••••••••••••</span>
                      {key.is_primary === 1 && (
                        <Badge variant="secondary" className="text-[8px] h-4 bg-primary/10 text-primary border-primary/20 font-bold px-1.5">PRIMARY</Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-tighter">
                      Added by <span className="text-foreground/80 font-bold">{key.provided_by_name || `@${key.provided_by}`}</span>
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive opacity-0 group-hover:opacity-100 transition-all hover:bg-destructive/10 h-8 w-8 cursor-pointer"
                    onClick={() => setDeleteConfirm({ id: key.id, isLast: config.api_keys.length === 1 })}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {(!config?.api_keys || config.api_keys.length === 0) && (
                <div className="text-center py-8 text-muted-foreground italic text-xs border border-dashed border-border/50 rounded-lg">
                  No keys configured
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Guild Configuration Section */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-xl transition-shadow duration-300">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary mb-1">
              <Hash className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">Configuration</span>
            </div>
            <CardTitle className="text-foreground">System Integration</CardTitle>
            <CardDescription className="text-muted-foreground/80">
              Select roles and channels for bot operations. Access restricted to owners.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] uppercase tracking-wider font-black text-muted-foreground">Log Ingestion Channel</Label>

              </div>
              <Select value={logChannelId || "none"} onValueChange={(v) => setLogChannelId(v === "none" ? "" : v)}>
                <SelectTrigger className="w-full h-10 font-bold bg-background border-border/50 hover:bg-accent/50 transition-all">
                  <SelectValue placeholder="Select a channel" />
                </SelectTrigger>
                <SelectContent className="bg-background border-border">
                  <SelectItem value="none" className="italic font-bold text-muted-foreground cursor-pointer">None (Disabled)</SelectItem>
                  {availableChannels.map((c: GuildItem) => (
                    <SelectItem key={c.id} value={c.id} className="cursor-pointer font-bold">
                      <span className="opacity-40 mr-2 text-xs">#</span>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Sentinel will transmit security alerts and audit logs to this identified text channel.
              </p>
            </div>

            <div className="space-y-3">
              <Label className="text-[10px] uppercase tracking-wider font-black text-muted-foreground">Administrative Roles</Label>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between h-10 px-3 font-bold uppercase text-[11px] bg-background border-border/50 hover:bg-accent/50 transition-all group"
                  >
                    <span className="truncate">
                      {selectedAdminRoles.length === 0
                        ? "Select Administrative Roles"
                        : selectedAdminRoles.map(id => availableRoles.find((r: GuildItem) => r.id === id)?.name).filter(Boolean).join(", ")
                      }
                    </span>
                    <ChevronDown className="w-4 h-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) max-h-[300px] overflow-y-auto custom-scrollbar p-2" align="start">
                  <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest opacity-50 px-2 py-1.5 focus:bg-accent/50">Available Roles</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={selectedAdminRoles.length === 0}
                    onCheckedChange={(checked) => {
                      if (checked) setSelectedAdminRoles([]);
                    }}
                    className="rounded-lg font-black uppercase text-[10px] py-2 focus:bg-primary/10 transition-colors cursor-pointer italic text-muted-foreground"
                  >
                    None (Clear All)
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  {availableRoles.map((r: GuildItem) => (
                    <DropdownMenuCheckboxItem
                      key={r.id}
                      checked={selectedAdminRoles.includes(r.id)}
                      onCheckedChange={() => toggleRole(r.id)}
                      className="rounded-lg font-black uppercase text-[10px] py-2 focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer"
                    >
                      {r.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent className="bg-background border-border rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-black uppercase tracking-tight text-foreground">
              {deleteConfirm?.isLast ? "🚨 CRITICAL WARNING" : "Confirm Deletion"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground leading-relaxed">
              {deleteConfirm?.isLast
                ? "This is your LAST API key. Deleting it will IMMEDIATELY DISABLE all automated features."
                : "Are you sure you want to remove this API key? This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="text-primary">Abort</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteConfirm && performDeleteKey(deleteConfirm.id)}
            >
              Confirm Removal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
