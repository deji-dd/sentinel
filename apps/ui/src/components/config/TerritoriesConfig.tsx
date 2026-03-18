import { useEffect, useState, useCallback } from "react";
import {
  Map as MapIcon,
  Plus,
  MoreVertical,
  Edit2,
  Copy,
  Trash2,
  Share2,
  ExternalLink,
  Search,
  Calendar,
  Loader2,
  Tag,
  Target,
  Globe,
  Lock,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface MapRecord {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  is_public: number;
  labelCount: number;
  ttCount: number;
}

interface TerritoriesConfigProps {
  sessionToken: string;
  channels: { id: string; name: string }[];
  currentUserId?: string;
}

export function TerritoriesConfig({
  sessionToken,
  channels,
  currentUserId,
}: TerritoriesConfigProps) {
  const navigate = useNavigate();
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isPublishOpen, setIsPublishOpen] = useState(false);

  const [selectedMap, setSelectedMap] = useState<MapRecord | null>(null);
  const [newName, setNewName] = useState("");
  const [targetChannel, setTargetChannel] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

  const fetchMaps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/map/list`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res.ok) throw new Error("Failed to fetch maps");
      const data = await res.json();
      setMaps(data);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load territory configurations");
    } finally {
      setLoading(false);
    }
  }, [sessionToken, API_BASE]);

  useEffect(() => {
    fetchMaps();
  }, [fetchMaps]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/map/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) throw new Error("Failed to create map");
      toast.success("Configuration created successfully");
      setIsCreateOpen(false);
      setNewName("");
      fetchMaps();
    } catch (err) {
      toast.error("Failed to create configuration");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRename = async () => {
    if (!selectedMap || !newName.trim()) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/map/${selectedMap.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) throw new Error("Failed to rename map");
      toast.success("Configuration renamed successfully");
      setIsRenameOpen(false);
      fetchMaps();
    } catch (err) {
      toast.error("Failed to rename configuration");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedMap) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/map/${selectedMap.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res.ok) throw new Error("Failed to delete map");
      toast.success("Configuration deleted successfully");
      setIsDeleteOpen(false);
      fetchMaps();
    } catch (err) {
      toast.error("Failed to delete configuration");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDuplicate = async (map: MapRecord) => {
    try {
      const res = await fetch(`${API_BASE}/api/map/${map.id}/duplicate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ name: `${map.name} (Copy)` }),
      });
      if (!res.ok) throw new Error("Failed to duplicate map");
      toast.success("Configuration duplicated");
      fetchMaps();
    } catch (err) {
      toast.error("Failed to duplicate configuration");
    }
  };
  const handleTogglePublic = async (map: MapRecord) => {
    try {
      const res = await fetch(`${API_BASE}/api/map/${map.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ isPublic: !map.is_public }),
      });
      if (!res.ok) throw new Error("Failed to update visibility");
      toast.success(`Map is now ${!map.is_public ? "public" : "private"}`);
      fetchMaps();
    } catch (err) {
      toast.error("Failed to update visibility");
    }
  };

  const handlePublish = async () => {
    if (!selectedMap || !targetChannel) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/map/${selectedMap.id}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ channelId: targetChannel }),
      });
      if (!res.ok) throw new Error("Failed to publish map");
      toast.success("Configuration published to Discord");
      setIsPublishOpen(false);
    } catch (err) {
      toast.error("Failed to publish configuration");
    } finally {
      setActionLoading(false);
    }
  };

  const filteredMaps = maps.filter((m) =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <Input
            placeholder="Search configurations..."
            className="pl-10 h-11 bg-secondary/20 border-border/50 rounded-xl focus:ring-primary/20"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button
          onClick={() => {
            setNewName("");
            setIsCreateOpen(true);
          }}
          size={"lg"}
        >
          <Plus />
          Create New Config
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4 opacity-50">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
          <p className="font-bold text-sm tracking-widest uppercase text-muted-foreground">
            Fetching Vault...
          </p>
        </div>
      ) : filteredMaps.length === 0 ? (
        <Card className="border-dashed border-2 bg-secondary/5 py-24 flex flex-col items-center text-center rounded-[2.5rem]">
          <div className="w-20 h-20 rounded-3xl bg-secondary flex items-center justify-center mb-6">
            <MapIcon className="w-10 h-10 text-muted-foreground/20" />
          </div>
          <h3 className="text-xl font-black uppercase tracking-tight text-foreground">
            No Configurations Found
          </h3>
          <p className="text-muted-foreground max-w-sm mt-2 mb-8">
            Start by creating your first territory war plan or scouting map.
          </p>
          <Button
            variant="outline"
            onClick={() => setIsCreateOpen(true)}
            className="rounded-xl border-border px-8 cursor-pointer"
          >
            Create First Map
          </Button>
        </Card>
      ) : (
        <div className="rounded-4xl border border-border/50 bg-card overflow-hidden shadow-xl">
          <Table>
            <TableHeader className="bg-secondary/30">
              <TableRow className="hover:bg-transparent border-border/50 h-14">
                <TableHead className="pl-8 font-black uppercase tracking-widest text-[10px]">
                  Title
                </TableHead>
                <TableHead className="font-black uppercase tracking-widest text-[10px]">
                  Labels
                </TableHead>
                <TableHead className="font-black uppercase tracking-widest text-[10px]">
                  Territories
                </TableHead>
                <TableHead className="font-black uppercase tracking-widest text-[10px]">
                  Access
                </TableHead>
                <TableHead className="font-black uppercase tracking-widest text-[10px]">
                  Last Updated
                </TableHead>
                <TableHead className="pr-8 text-right font-black uppercase tracking-widest text-[10px]">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMaps.map((map) => (
                <TableRow
                  key={map.id}
                  className="group border-border/50 hover:bg-secondary/10 transition-colors h-20"
                >
                  <TableCell className="pl-8 font-bold text-base">
                    <div className="flex flex-col">
                      <span className="text-foreground">{map.name}</span>
                      <span className="text-[9px] font-mono text-muted-foreground opacity-50 uppercase tracking-tighter">
                        ID: {map.id.split("-")[0]}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className="bg-primary/5 text-primary border-primary/10 rounded-lg px-2 py-0.5 flex items-center gap-1.5 w-fit"
                    >
                      <Tag className="w-3 h-3" />
                      {map.labelCount}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className="bg-secondary/50 text-foreground/70 border-border/50 rounded-lg px-2 py-0.5 flex items-center gap-1.5 w-fit"
                    >
                      <Target className="w-3 h-3" />
                      {map.ttCount}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {map.is_public ? (
                      <Badge
                        variant="outline"
                        className="bg-emerald-500/5 text-emerald-500 border-emerald-500/20 rounded-lg px-2 py-0.5 flex items-center gap-1.5 w-fit font-bold text-[10px] uppercase tracking-wider"
                      >
                        <Users className="w-3 h-3" />
                        Public
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="bg-zinc-500/5 text-muted-foreground/80 border-zinc-500/20 rounded-lg px-2 py-0.5 flex items-center gap-1.5 w-fit font-bold text-[10px] uppercase tracking-wider"
                      >
                        <Lock className="w-3 h-3" />
                        Private
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-muted-foreground font-medium text-sm">
                      <Calendar className="w-4 h-4 opacity-40" />
                      {new Date(map.updated_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="pr-8 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="lg"
                        onClick={() => navigate(`/selector?mapId=${map.id}`)}
                      >
                        Launch Painter <ExternalLink />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 rounded-xl bg-secondary border border-transparent hover:border-border/50 transition-all cursor-pointer"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-64 rounded-2xl border-border/50 p-2 shadow-2xl backdrop-blur-xl"
                        >
                          {currentUserId === map.created_by && (
                            <>
                              <DropdownMenuItem
                                onClick={() => handleTogglePublic(map)}
                                className="rounded-xl p-3 focus:bg-primary/10 cursor-pointer"
                              >
                                {map.is_public ? (
                                  <>
                                    <Lock className="w-4 h-4 mr-3 text-muted-foreground" />
                                    Make Private
                                  </>
                                ) : (
                                  <>
                                    <Globe className="w-4 h-4 mr-3 text-emerald-500" />
                                    Make Public
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="bg-border/50 mx-2" />
                            </>
                          )}
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedMap(map);
                              setNewName(map.name);
                              setIsRenameOpen(true);
                            }}
                            className="rounded-xl p-3 focus:bg-primary/10 cursor-pointer"
                          >
                            <Edit2 className="w-4 h-4 mr-3" />
                            Rename Config
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDuplicate(map)}
                            className="rounded-xl p-3 focus:bg-primary/10 cursor-pointer"
                          >
                            <Copy className="w-4 h-4 mr-3" />
                            Duplicate Plan
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedMap(map);
                              setIsPublishOpen(true);
                            }}
                            className="rounded-xl p-3 focus:bg-primary/10 cursor-pointer"
                          >
                            <Share2 className="w-4 h-4 mr-3 text-primary" />
                            Publish to Discord
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-border/50 mx-2" />
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedMap(map);
                              setIsDeleteOpen(true);
                            }}
                            className="rounded-xl p-3 focus:bg-destructive/10 text-destructive focus:text-destructive cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4 mr-3" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-2xl font-black uppercase tracking-tight text-foreground">
              Create Configuration
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Give your new territory config a descriptive name.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="e.g. Southside Expansion Plan"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={actionLoading || !newName.trim()}
            >
              {actionLoading ? <Loader2 className="animate-spin" /> : <Plus />}
              Create Config
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-2xl font-black uppercase tracking-tight text-foreground">
              Rename Configuration
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Updating title for{" "}
              <span className="text-primary font-bold">
                {selectedMap?.name}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Enter new name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={actionLoading || !newName.trim()}
            >
              {actionLoading ? <Loader2 className="animate-spin" /> : <Edit2 />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-2xl font-black uppercase tracking-tight text-destructive">
              Delete Configuration?
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will permanently delete{" "}
              <span className="font-bold text-foreground">
                "{selectedMap?.name}"
              </span>{" "}
              and all its territory assignments. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setIsDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={actionLoading}
              variant="destructive"
            >
              {actionLoading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish Dialog */}
      <Dialog open={isPublishOpen} onOpenChange={setIsPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-2xl font-black uppercase tracking-tight text-foreground">
              Publish to Discord
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Select a channel to send the summary and assignments for{" "}
              <span className="font-bold text-foreground">
                "{selectedMap?.name}"
              </span>
              .
            </DialogDescription>
          </DialogHeader>
          <div className="py-6 space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50 ml-1">
                Target Channel
              </label>
              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                {channels.map((ch) => (
                  <Button
                    key={ch.id}
                    variant={targetChannel === ch.id ? "secondary" : "ghost"}
                    onClick={() => setTargetChannel(ch.id)}
                    className={`justify-start h-10 rounded-xl font-bold transition-all ${targetChannel === ch.id ? "bg-primary/10 text-primary border border-primary/20" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <span className="opacity-40 mr-2 text-xs">#</span>
                    {ch.name}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsPublishOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handlePublish}
              disabled={actionLoading || !targetChannel}
            >
              {actionLoading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Share2 />
              )}
              Publish Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
