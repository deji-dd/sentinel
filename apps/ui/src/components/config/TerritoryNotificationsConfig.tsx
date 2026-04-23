import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
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
import { MapPin, Filter, Database, Users } from "lucide-react";
import { toast } from "sonner";
import { fetchWithFallback } from "@/lib/api-base";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface GuildItem {
  id: string;
  name: string;
}

export const TerritoryNotificationsConfig = forwardRef(
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

    const [ttFullChannelId, setTtFullChannelId] = useState<string>(
      initialData?.tt_full_channel_id || "",
    );
    const [ttFilteredChannelId, setTtFilteredChannelId] = useState<string>(
      initialData?.tt_filtered_channel_id || "",
    );
    const [ttTerritoryIds, setTtTerritoryIds] = useState<string>(
      ((initialData?.tt_territory_ids || []) as string[]).join(", "),
    );
    const [ttFactionIds, setTtFactionIds] = useState<string>(
      ((initialData?.tt_faction_ids || []) as number[]).join(", "),
    );

    const fetchConfig = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetchWithFallback("/api/config", {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!res.ok) throw new Error("Failed to fetch config");
        const data = await res.json();
        setConfig(data);

        setTtFullChannelId(data.tt_full_channel_id || "");
        setTtFilteredChannelId(data.tt_filtered_channel_id || "");
        setTtTerritoryIds((data.tt_territory_ids || []).join(", "));
        setTtFactionIds((data.tt_faction_ids || []).join(", "));

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

    useEffect(() => {
      if (!config) return;

      const parseIds = (input: string) =>
        input
          .split(",")
          .map((i) => i.trim())
          .filter((i) => i !== "");

      const currTerritories = parseIds(ttTerritoryIds).sort();
      const currFactions = parseIds(ttFactionIds).sort();

      const origTerritories = [...(config.tt_territory_ids || [])].sort();
      const origFactions = [...(config.tt_faction_ids || [])]
        .map(String)
        .sort();

      const isDirty =
        (ttFullChannelId || "") !== (config.tt_full_channel_id || "") ||
        (ttFilteredChannelId || "") !== (config.tt_filtered_channel_id || "") ||
        JSON.stringify(currTerritories) !== JSON.stringify(origTerritories) ||
        JSON.stringify(currFactions) !== JSON.stringify(origFactions);

      onDirtyChange?.(isDirty);
    }, [
      ttFullChannelId,
      ttFilteredChannelId,
      ttTerritoryIds,
      ttFactionIds,
      config,
      onDirtyChange,
    ]);

    const handleSaveSettings = async () => {
      try {
        const parseIds = (input: string) =>
          input
            .split(",")
            .map((i) => i.trim())
            .filter((i) => i !== "");

        const tIds = parseIds(ttTerritoryIds);
        const fIds = parseIds(ttFactionIds)
          .map((n) => Number.parseInt(n))
          .filter((n) => !Number.isNaN(n));

        const res = await fetchWithFallback("/api/config", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            tt_full_channel_id: ttFullChannelId || null,
            tt_filtered_channel_id: ttFilteredChannelId || null,
            tt_territory_ids: tIds,
            tt_faction_ids: fIds,
          }),
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
      save: handleSaveSettings,
    }));

    if (loading)
      return (
        <LoadingScreen
          fullScreen={false}
          subMessage="Loading Territory Config"
        />
      );

    const availableChannels = config?.channels || [];

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Full Notifications Section */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-xl transition-shadow duration-300">
            <CardHeader>
              <div className="flex items-center gap-2 text-primary mb-1">
                <Database className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">
                  Global Tracker
                </span>
              </div>
              <CardTitle className="text-foreground">
                Full Notifications
              </CardTitle>
              <CardDescription className="text-muted-foreground/80">
                Receive updates for all territory changes across Torn.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label className="text-[10px] uppercase tracking-wider font-black text-muted-foreground">
                  Notification Channel
                </Label>
                <Select
                  value={ttFullChannelId || "none"}
                  onValueChange={(v) =>
                    setTtFullChannelId(v === "none" ? "" : v)
                  }
                >
                  <SelectTrigger className="w-full h-10 font-bold bg-background border-border/50 hover:bg-accent/50 transition-all">
                    <SelectValue placeholder="Select a channel" />
                  </SelectTrigger>
                  <SelectContent className="bg-background border-border">
                    <SelectItem
                      value="none"
                      className="italic font-bold text-muted-foreground cursor-pointer"
                    >
                      None (Disabled)
                    </SelectItem>
                    {availableChannels.map((c: GuildItem) => (
                      <SelectItem
                        key={c.id}
                        value={c.id}
                        className="cursor-pointer font-bold"
                      >
                        <span className="opacity-40 mr-2 text-xs">#</span>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Filtered Notifications Section */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-xl transition-shadow duration-300">
            <CardHeader>
              <div className="flex items-center gap-2 text-primary mb-1">
                <Filter className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">
                  Filtered Alerts
                </span>
              </div>
              <CardTitle className="text-foreground">
                Filtered Notifications
              </CardTitle>
              <CardDescription className="text-muted-foreground/80">
                Receive updates for specific territories or factions you want to
                track.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label className="text-[10px] uppercase tracking-wider font-black text-muted-foreground">
                  Notification Channel
                </Label>
                <Select
                  value={ttFilteredChannelId || "none"}
                  onValueChange={(v) =>
                    setTtFilteredChannelId(v === "none" ? "" : v)
                  }
                >
                  <SelectTrigger className="w-full h-10 font-bold bg-background border-border/50 hover:bg-accent/50 transition-all">
                    <SelectValue placeholder="Select a channel" />
                  </SelectTrigger>
                  <SelectContent className="bg-background border-border">
                    <SelectItem
                      value="none"
                      className="italic font-bold text-muted-foreground cursor-pointer"
                    >
                      None (Disabled)
                    </SelectItem>
                    {availableChannels.map((c: GuildItem) => (
                      <SelectItem
                        key={c.id}
                        value={c.id}
                        className="cursor-pointer font-bold"
                      >
                        <span className="opacity-40 mr-2 text-xs">#</span>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label className="text-[10px] flex items-center gap-1.5 uppercase tracking-wider font-black text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  Territory IDs
                </Label>
                <Input
                  placeholder="e.g. ABC, DEF, XYZ"
                  value={ttTerritoryIds}
                  onChange={(e) => setTtTerritoryIds(e.target.value)}
                  className="font-mono bg-background/50 border-border/50 text-foreground"
                />
                <p className="text-[10px] text-muted-foreground">
                  Comma separated list of territory names to monitor.
                </p>
              </div>

              <div className="space-y-3">
                <Label className="text-[10px] flex items-center gap-1.5 uppercase tracking-wider font-black text-muted-foreground">
                  <Users className="w-3 h-3" />
                  Faction IDs
                </Label>
                <Input
                  placeholder="e.g. 13784, 8881"
                  value={ttFactionIds}
                  onChange={(e) => setTtFactionIds(e.target.value)}
                  className="font-mono bg-background/50 border-border/50 text-foreground"
                />
                <p className="text-[10px] text-muted-foreground">
                  Comma separated list of faction IDs to monitor.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  },
);
