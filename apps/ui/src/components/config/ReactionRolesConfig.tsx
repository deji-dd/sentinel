import { useState, useEffect } from "react";
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
import { Plus, Trash2, Send, ChevronDown, Info, Edit3 } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchWithFallback } from "@/lib/api-base";

interface GuildItem {
  id: string;
  name: string;
}

interface ReactionMapping {
  id?: number;
  emoji: string;
  role_id: string;
}

interface ReactionMessage {
  id?: number;
  channel_id: string;
  title: string;
  description: string;
  required_role_id?: string; // Stored as comma separated string on backend, we can still receive it as such
  required_role_ids?: string[]; // Used in UI for multiple selection
  sync_roles: boolean;
  mappings: ReactionMapping[];
}

export const ReactionRolesConfig = ({
  sessionToken,
  availableChannels,
  availableRoles,
}: {
  sessionToken: string;
  availableChannels: GuildItem[];
  availableRoles: GuildItem[];
}) => {
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ReactionMessage[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newMsg, setNewMsg] = useState<ReactionMessage>({
    channel_id: "",
    title: "",
    description: "",
    required_role_ids: [],
    sync_roles: false,
    mappings: [{ emoji: "", role_id: "" }],
  });

  const openEdit = (msg: ReactionMessage) => {
    setEditingId(msg.id!);
    setNewMsg({
      ...msg,
      required_role_ids: msg.required_role_id
        ? msg.required_role_id.split(",")
        : [],
    });
    setIsCreating(true);
  };

  const closeDialog = () => {
    setIsCreating(false);
    setEditingId(null);
    setNewMsg({
      channel_id: "",
      title: "",
      description: "",
      required_role_ids: [],
      sync_roles: false,
      mappings: [{ emoji: "", role_id: "" }],
    });
  };

  const fetchMessages = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetchWithFallback("/api/config/reaction-roles", {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res.ok) throw new Error("Failed to fetch reaction roles");
      const data = await res.json();
      setMessages(data);
    } catch (err) {
      toast.error("Failed to load reaction roles");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, [sessionToken]);

  const [msgToDelete, setMsgToDelete] = useState<number | null>(null);

  const handleDelete = async () => {
    if (!msgToDelete) return;

    try {
      const res = await fetchWithFallback(
        `/api/config/reaction-roles/${msgToDelete}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${sessionToken}` },
        },
      );
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Message deleted");
      setMsgToDelete(null);
      await fetchMessages(true);
    } catch {
      toast.error("Failed to delete message");
    }
  };

  const getFirstEmoji = (str: string) => {
    const trimmed = str.trim();
    if (!trimmed) return "";
    const discordMatch = trimmed.match(/^<a?:\w+:\d+>/);
    if (discordMatch) return discordMatch[0];
    try {
      const segmenter = new (Intl as any).Segmenter("en", {
        granularity: "grapheme",
      });
      const segments = [...segmenter.segment(trimmed)];
      return segments.length > 0 ? segments[0].segment : "";
    } catch {
      return [...trimmed][0] || "";
    }
  };

  const isEmoji = (str: string) => {
    if (!str) return false;
    const unicodeEmojiRegex =
      /^(\p{Extended_Pictographic}|\p{Emoji_Component})+$/u;
    const discordEmojiRegex = /^<a?:\w+:\d+>$/;
    const normalized = str.trim();
    if (discordEmojiRegex.test(normalized)) return true;
    try {
      const segmenter = new (Intl as any).Segmenter("en", {
        granularity: "grapheme",
      });
      const segments = [...segmenter.segment(normalized)];
      return segments.length === 1 && unicodeEmojiRegex.test(normalized);
    } catch {
      return unicodeEmojiRegex.test(normalized);
    }
  };

  const handleCreate = async () => {
    if (!newMsg.channel_id) {
      toast.error("Please select a channel");
      return;
    }

    const invalidEmoji = newMsg.mappings.find(
      (m) => m.emoji && !isEmoji(m.emoji),
    );
    if (invalidEmoji) {
      toast.error(
        `"${invalidEmoji.emoji}" is not a valid emoji or contains multiple emojis.`,
      );
      return;
    }

    const validMappings = newMsg.mappings.filter((m) => m.emoji && m.role_id);
    if (validMappings.length === 0) {
      toast.error("Please add at least one valid mapping");
      return;
    }

    try {
      toast.loading(editingId ? "Updating message..." : "Posting message...", {
        id: "save-msg",
      });
      const res = await fetchWithFallback(
        `/api/config/reaction-roles${editingId ? `/${editingId}` : ""}`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            ...newMsg,
            required_role_id: newMsg.required_role_ids?.length
              ? newMsg.required_role_ids.join(",")
              : null,
            mappings: validMappings,
          }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      toast.success(
        editingId ? "Message updated!" : "Message posted to Discord!",
        { id: "save-msg" },
      );
      closeDialog();
      await fetchMessages(true);
    } catch (err: any) {
      toast.error(`Error: ${err.message}`, { id: "save-msg" });
    }
  };

  if (loading)
    return (
      <LoadingScreen fullScreen={false} subMessage="Loading Reaction Roles" />
    );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex justify-between items-center bg-card/50 backdrop-blur-sm border border-border/50 p-6 rounded-2xl">
        <div>
          <h3 className="text-xl font-bold text-foreground tracking-tight">
            Reaction Role Messages
          </h3>
          <p className="text-sm text-muted-foreground">
            Manage messages that allow members to self-assign roles.
          </p>
        </div>
        <Button onClick={() => setIsCreating(true)} className="font-bold gap-2">
          <Plus className="w-4 h-4" />
          New Message
        </Button>
      </div>

      <Dialog open={isCreating} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-150 border-border/50 bg-card/95 backdrop-blur-xl shadow-2xl p-0 overflow-hidden gap-0">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-2xl font-bold tracking-tight">
              {editingId ? "Edit Message" : "Create Reaction Message"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editingId
                ? "Update your existing reaction role message metadata and mappings."
                : "Setup a new message to allow users to assign roles to themselves."}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] p-6 pt-2">
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label>
                    Channel {editingId ? "(Cannot change)" : "to Post In"}
                  </Label>
                  <Select
                    disabled={!!editingId}
                    value={newMsg.channel_id}
                    onValueChange={(v) =>
                      setNewMsg({ ...newMsg, channel_id: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select text channel" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableChannels.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          # {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  <Label className="flex items-center gap-2">
                    Required Roles (Optional)
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs font-bold">
                            Members must have AT LEAST ONE of the selected roles
                            to use this reaction message.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-between font-bold h-10 px-3 bg-background border-border/50 hover:bg-accent/50"
                      >
                        <span className="truncate">
                          {newMsg.required_role_ids?.length
                            ? `${newMsg.required_role_ids.length} role(s) selected`
                            : "Everyone can react"}
                        </span>
                        <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-70 max-h-75 overflow-y-auto bg-background border-border shadow-2xl">
                      <DropdownMenuLabel>
                        Select required roles
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {availableRoles.map((role) => (
                        <DropdownMenuCheckboxItem
                          key={role.id}
                          checked={newMsg.required_role_ids?.includes(role.id)}
                          onCheckedChange={(checked) => {
                            const ids = newMsg.required_role_ids || [];
                            if (checked) {
                              setNewMsg({
                                ...newMsg,
                                required_role_ids: [...ids, role.id],
                              });
                            } else {
                              setNewMsg({
                                ...newMsg,
                                required_role_ids: ids.filter(
                                  (id) => id !== role.id,
                                ),
                              });
                            }
                          }}
                          className="font-bold cursor-pointer"
                        >
                          {role.name}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="space-y-3 px-1">
                <Label>Message Title</Label>
                <Input
                  placeholder="e.g. Select Your Pronouns"
                  value={newMsg.title}
                  onChange={(e) =>
                    setNewMsg({ ...newMsg, title: e.target.value })
                  }
                />
              </div>

              <div className="space-y-3 px-1">
                <Label>Message Description</Label>
                <Textarea
                  placeholder="Leave blank for an auto-generated list of role mappings..."
                  rows={3}
                  value={newMsg.description}
                  onChange={(e) =>
                    setNewMsg({ ...newMsg, description: e.target.value })
                  }
                  className="resize-none"
                />
              </div>

              {newMsg.required_role_ids &&
                newMsg.required_role_ids.length > 0 && (
                  <div className="flex items-center space-x-3 p-4 bg-primary/5 rounded-xl border border-primary/20">
                    <Checkbox
                      id="sync_roles"
                      checked={newMsg.sync_roles}
                      onCheckedChange={(c) =>
                        setNewMsg({ ...newMsg, sync_roles: !!c })
                      }
                    />
                    <Label
                      htmlFor="sync_roles"
                      className="flex flex-col gap-1 cursor-pointer"
                    >
                      <span className="font-bold">Strict Sync</span>
                      <span className="font-normal text-muted-foreground text-xs leading-relaxed">
                        If checked, the assigned roles will be automatically
                        removed if the user loses their Required Role.
                      </span>
                    </Label>
                  </div>
                )}

              <div className="space-y-4 pt-4 border-t border-border/50">
                <div className="flex justify-between items-center">
                  <Label className="text-lg">Emoji → Role Mappings</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewMsg({
                        ...newMsg,
                        mappings: [
                          ...newMsg.mappings,
                          { emoji: "", role_id: "" },
                        ],
                      })
                    }
                  >
                    <Plus className="w-3 h-3 mr-2" />
                    Add Mapping
                  </Button>
                </div>

                {newMsg.mappings.map((m, idx) => (
                  <div
                    key={idx}
                    className="flex px-1 items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-300"
                  >
                    <Input
                      placeholder="Emoji"
                      className={cn(
                        "w-20 text-center font-bold font-emoji h-10 transition-all",
                        m.emoji &&
                          !isEmoji(m.emoji) &&
                          "border-destructive ring-destructive focus-visible:ring-destructive",
                      )}
                      value={m.emoji}
                      onChange={(e) => {
                        const singleEmoji = getFirstEmoji(e.target.value);
                        const nm = [...newMsg.mappings];
                        nm[idx].emoji = singleEmoji;
                        setNewMsg({ ...newMsg, mappings: nm });
                      }}
                    />
                    <Select
                      value={m.role_id || "none"}
                      onValueChange={(v) => {
                        const nm = [...newMsg.mappings];
                        nm[idx].role_id = v;
                        setNewMsg({ ...newMsg, mappings: nm });
                      }}
                    >
                      <SelectTrigger className="flex-1 h-10">
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableRoles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="destructive"
                      size="icon"
                      onClick={() => {
                        const nm = [...newMsg.mappings];
                        nm.splice(idx, 1);
                        setNewMsg({ ...newMsg, mappings: nm });
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="p-6 bg-muted/20 border-t border-border/50">
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              className={cn(
                "font-bold",
                editingId && "bg-blue-600 hover:bg-blue-700",
              )}
            >
              {editingId ? (
                <Edit3 className="w-4 h-4 mr-2" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              {editingId ? "Update Message" : "Post to Discord"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Current Messages list */}
      <div
        className={cn(
          messages.length > 0 && "grid grid-cols-1 lg:grid-cols-2 gap-6",
        )}
      >
        {messages.map((msg) => (
          <Card
            key={msg.id}
            className="border-border/50 bg-card/30 flex flex-col"
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="space-y-1">
                <CardTitle className="text-lg text-primary truncate max-w-50">
                  {msg.title}
                </CardTitle>
                <CardDescription className="truncate">
                  <span className="text-foreground font-mono bg-background/50 px-1.5 py-0.5 rounded text-[10px]">
                    #
                    {availableChannels.find((c) => c.id === msg.channel_id)
                      ?.name || msg.channel_id}
                  </span>
                </CardDescription>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => openEdit(msg)}
                  className="h-8 w-8"
                >
                  <Edit3 className="w-4 h-4" />
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setMsgToDelete(msg.id!)}
                  className="h-8 w-8"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <div className="flex flex-col gap-2">
                    <span className="text-muted-foreground font-bold uppercase text-[10px]">
                      Required Role(s)
                    </span>
                    {msg.required_role_id ? (
                      <div className="flex flex-wrap gap-1.5">
                        {msg.required_role_id.split(",").map((roleId) => {
                          const roleObj = availableRoles.find(
                            (r) => r.id === roleId,
                          );
                          return (
                            <span
                              key={roleId}
                              className="px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded-md text-[10px] font-bold"
                            >
                              {roleObj?.name || roleId}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic text-xs">
                        None (Everyone)
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground mr-2 font-bold uppercase text-[10px] block mb-1">
                    Strict Sync
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-bold px-2 py-0.5 rounded-full",
                      msg.sync_roles
                        ? "bg-green-500/20 text-green-400 border border-green-500/20"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {msg.sync_roles ? "ENABLED" : "DISABLED"}
                  </span>
                </div>
              </div>

              <div className="bg-background/50 rounded-xl border border-border/50 p-4">
                <h4 className="text-[10px] uppercase font-black tracking-widest text-muted-foreground mb-3">
                  Mappings
                </h4>
                <div className="space-y-2">
                  {msg.mappings.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between text-sm py-1.5 border-b border-border/20 last:border-0 font-medium"
                    >
                      <span className="text-xl px-2">{m.emoji}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-foreground/80 truncate ml-2">
                        {availableRoles.find((r) => r.id === m.role_id)?.name ||
                          m.role_id}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AlertDialog
        open={!!msgToDelete}
        onOpenChange={(o) => !o && setMsgToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the reaction role message and all its
              mappings. The message will also be removed from Discord
              immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} variant={"destructive"}>
              Yes, delete message
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {messages.length === 0 && (
        <div className="py-16 text-center text-muted-foreground opacity-60">
          No reaction role messages found. Create one to get started!
        </div>
      )}
    </div>
  );
};
