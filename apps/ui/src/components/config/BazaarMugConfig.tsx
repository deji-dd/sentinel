import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  forwardRef,
} from "react";
import { LoadingScreen } from "@/components/loading-screen";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { fetchWithFallback } from "@/lib/api-base";
import {
  Plus,
  Trash2,
  Users,
  Target,
  DollarSign,
} from "lucide-react";

interface BazaarMugSettings {
  guild_id: string;
  is_enabled: number;
  min_bazaar_drop_threshold: number;
  ping_role_id: string | null;
  notification_channel_id: string | null;
  target_player_ids: string[];
}

interface BazaarMugConfigProps {
  sessionToken: string;
  initialData: any;
  onDirtyChange?: (isDirty: boolean) => void;
}

export const BazaarMugConfig = forwardRef<any, BazaarMugConfigProps>(
  ({ sessionToken, initialData, onDirtyChange }, ref) => {
    const [loading, setLoading] = useState(true);
    const [settings, setSettings] = useState<BazaarMugSettings | null>(null);
    const [settingsBaseline, setSettingsBaseline] = useState<BazaarMugSettings | null>(null);
    const [newPlayerId, setNewPlayerId] = useState("");

    const availableChannels = useMemo(
      () => initialData?.channels || initialData?.available_channels || [],
      [initialData],
    );

    const availableRoles = useMemo(
      () => initialData?.roles || initialData?.available_roles || [],
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
        const response = await fetchWithFallback("/api/config/bazaar-mug", {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!response.ok) throw new Error("Failed to load bazaar mug config");
        const payload = await response.json();
        const loadedSettings = {
          ...payload.settings,
          target_player_ids: payload.settings.target_player_ids || [],
        };
        setSettings(loadedSettings);
        setSettingsBaseline(loadedSettings);
      } catch (error) {
        console.error("[BazaarMugConfig] Failed to load:", error);
        toast.error("Failed to load bazaar mug config");
      } finally {
        if (!silent) setLoading(false);
      }
    };

    useEffect(() => {
      loadData();
    }, [sessionToken]);

    const saveSettings = async () => {
      if (!settings) return false;

      try {
        const response = await fetchWithFallback("/api/config/bazaar-mug", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            ...settings,
            min_bazaar_drop_threshold: settings.min_bazaar_drop_threshold || 10000000,
          }),
        });

        if (!response.ok) {
          const payload = await response
            .json()
            .catch(() => ({ error: "Failed to save settings" }));
          throw new Error(payload.error || "Failed to save settings");
        }

        toast.success("Bazaar Mug configuration saved");
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

    const addPlayerId = () => {
      if (!newPlayerId.trim()) return;
      const parsedId = newPlayerId.trim();
      if (!/^\d+$/.test(parsedId)) {
        toast.error("Player ID must be a numeric value");
        return;
      }

      setSettings((current) => {
        if (!current) return null;
        if (current.target_player_ids.includes(parsedId)) {
          toast.error("Player ID is already in the watchlist");
          return current;
        }
        return {
          ...current,
          target_player_ids: [...current.target_player_ids, parsedId],
        };
      });
      setNewPlayerId("");
    };

    const removePlayerId = (idToRemove: string) => {
      setSettings((current) => {
        if (!current) return null;
        return {
          ...current,
          target_player_ids: current.target_player_ids.filter(
            (id) => id !== idToRemove,
          ),
        };
      });
    };

    if (loading || !settings) {
      return (
        <LoadingScreen
          fullScreen={false}
          subMessage="Loading Bazaar Mug Module"
        />
      );
    }

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">

        {/* Module Master Enable Card */}
        <div className="bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs flex items-center justify-between shadow-lg">
          <div className="space-y-0.5">
            <Label className="text-sm font-bold text-foreground">Enable Tracking</Label>
            <p className="text-xs text-muted-foreground">
              Turn bazaar monitoring on or off for this guild.
            </p>
          </div>
          <Switch
            checked={settings.is_enabled === 1}
            onCheckedChange={(checked) =>
              setSettings((current) =>
                current ? { ...current, is_enabled: checked ? 1 : 0 } : null,
              )
            }
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: General Settings Card */}
          <div className="space-y-5 bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs shadow-md">
            <div className="flex items-center gap-2 text-foreground font-bold border-b border-border/30 pb-3">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              <span>Target Constraints</span>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="min-bazaar-drop-threshold">Minimum Bazaar Drop Threshold</Label>
                <div className="relative">
                  <Input
                    id="min-bazaar-drop-threshold"
                    type="number"
                    min={0}
                    value={settings.min_bazaar_drop_threshold === 0 ? "" : settings.min_bazaar_drop_threshold}
                    onChange={(e) =>
                      setSettings((current) =>
                        current
                          ? {
                            ...current,
                            min_bazaar_drop_threshold: Number(e.target.value),
                          }
                          : null,
                      )
                    }
                    placeholder="10000000"
                    className="pl-8"
                  />
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">
                    $
                  </div>
                </div>
                <p className="text-xs text-muted-foreground/80">
                  Alert when a target's bazaar total value drops by this threshold amount or more.
                </p>
                {settings.min_bazaar_drop_threshold > 0 && (
                  <div className="text-[10px] text-emerald-500/90 font-mono mt-1">
                    Value format: ${Number(settings.min_bazaar_drop_threshold).toLocaleString()}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Notification Channel</Label>
                <Select
                  value={settings.notification_channel_id || "none"}
                  onValueChange={(val) =>
                    setSettings((current) =>
                      current
                        ? {
                          ...current,
                          notification_channel_id: val === "none" ? null : val,
                        }
                        : null,
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select channel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {availableChannels.map((ch: any) => (
                      <SelectItem key={ch.id} value={ch.id}>
                        {ch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground/80">
                  Target alerts will be posted as Discord embeds in this channel.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Mention Role (Optional)</Label>
                <Select
                  value={settings.ping_role_id || "none"}
                  onValueChange={(val) =>
                    setSettings((current) =>
                      current
                        ? {
                          ...current,
                          ping_role_id: val === "none" ? null : val,
                        }
                        : null,
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {availableRoles.map((r: any) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground/80">
                  Role to ping when a high-value bazaar target is found.
                </p>
              </div>
            </div>
          </div>

          {/* Right: Watchlist Card */}
          <div className="space-y-5 bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs shadow-md">
            <div className="flex items-center justify-between border-b border-border/30 pb-3">
              <div className="flex items-center gap-2 text-foreground font-bold">
                <Users className="w-4 h-4 text-indigo-500" />
                <span>Player Watchlist</span>
              </div>
              <Badge variant="outline" className="font-mono bg-background/50">
                {settings.target_player_ids.length}
              </Badge>
            </div>

            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  type="text"
                  pattern="\d*"
                  placeholder="Enter Player Torn ID (e.g. 123456)"
                  value={newPlayerId}
                  onChange={(e) => setNewPlayerId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPlayerId();
                    }
                  }}
                />
                <Button onClick={addPlayerId} className="shrink-0 font-bold">
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              </div>

              <div className="border border-border/30 rounded-2xl p-4 min-h-48 max-h-64 overflow-y-auto bg-background/20 space-y-2">
                {settings.target_player_ids.length === 0 ? (
                  <div className="h-40 flex flex-col items-center justify-center text-center space-y-2 opacity-50">
                    <Target className="w-8 h-8 text-muted-foreground stroke-1" />
                    <p className="text-xs text-muted-foreground italic">
                      Watchlist is empty. Add Player IDs above to begin tracking.
                    </p>
                  </div>
                ) : (
                  settings.target_player_ids.map((id) => (
                    <div
                      key={id}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-border/20 bg-card/40 hover:bg-card/75 transition-colors"
                    >
                      <span className="font-mono text-xs text-foreground font-bold">
                        Player ID: {id}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removePlayerId(id)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive w-8 h-8 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

BazaarMugConfig.displayName = "BazaarMugConfig";
export default BazaarMugConfig;
