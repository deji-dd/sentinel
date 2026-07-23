"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Trash2, Pencil, X, Loader2, SmilePlus, Hash, Shield, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import {
  getReactionRoleMessages,
  createReactionRoleMessage,
  updateReactionRoleMessage,
  deleteReactionRoleMessage,
  addEmojiMapping,
  deleteEmojiMapping,
} from "@/actions/guilds";
import type { ReactionRoleMessageWithMappings, ReactionRoleMappingDocument } from "@sentinel/shared";

interface ReactionsTabProps {
  guildId: string;
  channels: { id: string; name: string; type: number }[];
  roles: { id: string; name: string; color: number; position: number }[];
}

/** Returns a CSS hex color from a Discord role integer, or a fallback. */
function roleColor(color: number): string {
  if (!color) return "#71717a";
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Returns a friendly display name for a channel by ID. */
function channelName(channels: { id: string; name: string }[], id: string): string {
  return channels.find((c) => c.id === id)?.name || id;
}

// ─── Emoji Mapping Row ────────────────────────────────────────────────────────

interface EmojiMappingRowProps {
  guildId: string;
  msgId: string;
  mapping: { id: string; emoji: string; role_id: string };
  roles: { id: string; name: string; color: number }[];
  onDeleted: (id: string) => void;
}

function EmojiMappingRow({ guildId, msgId, mapping, roles, onDeleted }: EmojiMappingRowProps) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    const res = await deleteEmojiMapping(guildId, msgId, mapping.id);
    setDeleting(false);
    if (res.success) {
      onDeleted(mapping.id);
    } else {
      toast.error(res.error || "Failed to remove emoji mapping.");
    }
  };

  const role = roles.find((r) => r.id === mapping.role_id);

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-zinc-50/80 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800">
      <span className="text-lg leading-none select-none min-w-6 text-center">{mapping.emoji}</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">→</span>
      <span
        className="text-xs font-bold px-2 py-0.5 rounded-full border"
        style={{ color: roleColor(role?.color ?? 0), borderColor: `${roleColor(role?.color ?? 0)}40`, backgroundColor: `${roleColor(role?.color ?? 0)}15` }}
      >
        @{role?.name || mapping.role_id}
      </span>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="ml-auto text-zinc-400 hover:text-red-500 transition-colors cursor-pointer p-1 rounded-full hover:bg-red-500/10 disabled:opacity-50"
      >
        {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
      </button>
    </div>
  );
}

/** Validates if string is a valid Unicode emoji or Discord custom emoji format */
function isValidEmoji(str: string): boolean {
  const trimmed = str.trim();
  if (!trimmed) return false;
  // Match Discord custom emoji format: <:name:id> or <a:name:id> or name:id
  const discordEmojiRegex = /^<a?:[\w_]+:\d{17,20}>$/;
  const discordRawRegex = /^[\w_]+:\d{17,20}$/;
  if (discordEmojiRegex.test(trimmed) || discordRawRegex.test(trimmed)) {
    return true;
  }
  // Match standard unicode emoji
  const unicodeEmojiRegex = /\p{Extended_Pictographic}/u;
  return unicodeEmojiRegex.test(trimmed);
}

// ─── Add Emoji Form ───────────────────────────────────────────────────────────

interface AddEmojiFormProps {
  guildId: string;
  msgId: string;
  roles: { id: string; name: string; color: number; position: number }[];
  onAdded: (mapping: ReactionRoleMappingDocument) => void;
}

function AddEmojiForm({ guildId, msgId, roles, onAdded }: AddEmojiFormProps) {
  const [emoji, setEmoji] = useState("");
  const [roleId, setRoleId] = useState("");
  const [adding, setAdding] = useState(false);

  const handle = async () => {
    const trimmedEmoji = emoji.trim();
    if (!trimmedEmoji || !roleId) return;

    if (!isValidEmoji(trimmedEmoji)) {
      toast.error("Please enter a valid Unicode emoji (e.g. 👍) or Discord custom emoji (e.g. <:name:123456789>).");
      return;
    }

    setAdding(true);
    const res = await addEmojiMapping(guildId, msgId, { emoji: trimmedEmoji, role_id: roleId });
    setAdding(false);
    if (res.success && res.mapping) {
      onAdded(res.mapping);
      setEmoji("");
      setRoleId("");
    } else {
      toast.error(res.error || "Failed to add emoji mapping.");
    }
  };

  const sortedRoles = [...roles].sort((a, b) => b.position - a.position).filter((r) => r.name !== "@everyone");

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Input
        placeholder="Emoji (👍 or <:name:id>)"
        value={emoji}
        onChange={(e) => setEmoji(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handle(); } }}
        className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-sm w-48 font-mono"
      />
      <div className="relative flex-1 min-w-40">
        <select
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2 pl-3 pr-9 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
        >
          <option value="">Select role...</option>
          {sortedRoles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500">
          <ChevronDown className="size-3.5" />
        </div>
      </div>
      <Button
        type="button"
        onClick={handle}
        disabled={!emoji.trim() || !roleId || adding}
        className="bg-zinc-900 dark:bg-white text-white dark:text-black font-bold text-xs h-9 px-3.5 cursor-pointer"
      >
        {adding ? <Loader2 className="size-3.5 animate-spin" /> : <><Plus className="size-3.5 mr-1" />Add</>}
      </Button>
    </div>
  );
}

// ─── Delete Confirmation Modal ────────────────────────────────────────────────

interface DeleteConfirmModalProps {
  title: string;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

function DeleteConfirmModal({ title, onClose, onConfirm, isDeleting }: DeleteConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal Card */}
      <div className="relative z-10 w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl p-6 space-y-4 animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="flex items-center gap-3 text-red-500">
          <div className="size-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
            <Trash2 className="size-5 text-red-500" />
          </div>
          <div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-white">Delete Message</h3>
            <p className="text-xs text-zinc-500">This action cannot be undone.</p>
          </div>
        </div>

        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Are you sure you want to delete <span className="font-semibold text-zinc-900 dark:text-zinc-200">&quot;{title}&quot;</span> and all of its configured emoji-role mappings?
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={isDeleting} className="cursor-pointer text-xs h-8 px-3">
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-red-600 hover:bg-red-500 text-white font-bold text-xs h-8 px-4 cursor-pointer"
          >
            {isDeleting ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
            Delete Message
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Message Card ─────────────────────────────────────────────────────────────

interface MessageCardProps {
  guildId: string;
  message: ReactionRoleMessageWithMappings;
  channels: { id: string; name: string; type: number }[];
  roles: { id: string; name: string; color: number; position: number }[];
  onEdit: (msg: ReactionRoleMessageWithMappings) => void;
  onRequestDelete: (msg: ReactionRoleMessageWithMappings) => void;
  onUpdated: (msg: ReactionRoleMessageWithMappings) => void;
}

function MessageCard({ guildId, message, channels, roles, onEdit, onRequestDelete, onUpdated }: MessageCardProps) {
  const [emojis, setEmojis] = useState(message.emojis);

  const handleEmojiAdded = (mapping: ReactionRoleMappingDocument) => {
    const updated = [...emojis, mapping];
    setEmojis(updated);
    onUpdated({ ...message, emojis: updated });
  };

  const handleEmojiDeleted = (id: string) => {
    const updated = emojis.filter((e) => e.id !== id);
    setEmojis(updated);
    onUpdated({ ...message, emojis: updated });
  };

  const requiredRole = roles.find((r) => r.id === message.required_role_id);

  return (
    <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-l-4 border-l-pink-500 shadow-xs">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <CardTitle className="text-base font-bold truncate">{message.title}</CardTitle>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                <Hash className="size-3" />
                {channelName(channels, message.channel_id)}
              </span>
              {requiredRole && (
                <span
                  className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border"
                  style={{ color: roleColor(requiredRole.color), borderColor: `${roleColor(requiredRole.color)}40`, backgroundColor: `${roleColor(requiredRole.color)}15` }}
                >
                  <Shield className="size-2.5" />
                  Requires @{requiredRole.name}
                </span>
              )}
              <Badge variant="outline" className="font-mono text-[10px] border-pink-500/30 text-pink-600 dark:text-pink-300 bg-pink-500/5">
                {emojis.length} {emojis.length === 1 ? "reaction" : "reactions"}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(message)}
              className="h-7 w-7 text-zinc-500 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRequestDelete(message)}
              className="h-7 w-7 text-zinc-500 hover:text-red-500 cursor-pointer"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {emojis.length > 0 && (
          <div className="space-y-1.5">
            {emojis.map((m) => (
              <EmojiMappingRow
                key={m.id}
                guildId={guildId}
                msgId={message.id}
                mapping={m}
                roles={roles}
                onDeleted={handleEmojiDeleted}
              />
            ))}
          </div>
        )}
        <AddEmojiForm
          guildId={guildId}
          msgId={message.id}
          roles={roles}
          onAdded={handleEmojiAdded}
        />
      </CardContent>
    </Card>
  );
}

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

interface MessageModalProps {
  guildId: string;
  message: ReactionRoleMessageWithMappings | null; // null = create mode
  channels: { id: string; name: string; type: number }[];
  roles: { id: string; name: string; color: number; position: number }[];
  onClose: () => void;
  onSaved: (msg: ReactionRoleMessageWithMappings) => void;
}

function MessageModal({ guildId, message, channels, roles, onClose, onSaved }: MessageModalProps) {
  const isEdit = message !== null;
  const [title, setTitle] = useState(message?.title ?? "");
  const [channelId, setChannelId] = useState(message?.channel_id ?? "");
  const [requiredRoleId, setRequiredRoleId] = useState(message?.required_role_id ?? "");
  const [saving, setSaving] = useState(false);

  const textChannels = channels.filter((c) => c.type === 0 || c.type === 5);
  const sortedRoles = [...roles].sort((a, b) => b.position - a.position).filter((r) => r.name !== "@everyone");

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Title is required."); return; }
    if (!channelId) { toast.error("Channel is required."); return; }

    setSaving(true);
    if (isEdit) {
      const res = await updateReactionRoleMessage(guildId, message.id, {
        title: title.trim(),
        channel_id: channelId,
        required_role_id: requiredRoleId || null,
      });
      setSaving(false);
      if (res.success && res.message) {
        toast.success("Message updated.");
        onSaved({ ...res.message, emojis: message.emojis });
        onClose();
      } else {
        toast.error(res.error || "Failed to update.");
      }
    } else {
      const res = await createReactionRoleMessage(guildId, {
        title: title.trim(),
        channel_id: channelId,
        required_role_id: requiredRoleId || null,
      });
      setSaving(false);
      if (res.success && res.message) {
        toast.success("Reaction role message created.");
        onSaved(res.message);
        onClose();
      } else {
        toast.error(res.error || "Failed to create.");
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl p-6 space-y-5 animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
            {isEdit ? "Edit Message" : "New Reaction Role Message"}
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Message Title</label>
            <Input
              placeholder="e.g. Pick Your Roles"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10"
            />
          </div>

          {/* Channel */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Text Channel</label>
            <div className="relative">
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2.5 pl-3.5 pr-10 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
              >
                <option value="">Select channel...</option>
                {textChannels.map((c) => (
                  <option key={c.id} value={c.id}>#{c.name}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500">
                <ChevronDown className="size-4" />
              </div>
            </div>
          </div>

          {/* Required Role (optional) */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">
              Required Role <span className="font-normal normal-case tracking-normal text-zinc-400">(optional — user must have this role to interact)</span>
            </label>
            <div className="relative">
              <select
                value={requiredRoleId}
                onChange={(e) => setRequiredRoleId(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl py-2.5 pl-3.5 pr-10 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none appearance-none cursor-pointer"
              >
                <option value="">No requirement</option>
                {sortedRoles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500">
                <ChevronDown className="size-4" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} className="cursor-pointer text-sm">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-pink-600 hover:bg-pink-500 text-white font-bold text-sm cursor-pointer"
          >
            {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            {isEdit ? "Save Changes" : "Create Message"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── ReactionsTab (root) ──────────────────────────────────────────────────────

/**
 * Reaction Roles tab — create and manage per-channel emoji→role message menus.
 */
export function ReactionsTab({ guildId, channels, roles }: ReactionsTabProps) {
  const [messages, setMessages] = useState<ReactionRoleMessageWithMappings[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ReactionRoleMessageWithMappings | null>(null);
  const [deletingMessage, setDeletingMessage] = useState<ReactionRoleMessageWithMappings | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    const res = await getReactionRoleMessages(guildId);
    setLoading(false);
    if (res.success && res.messages) {
      setMessages(res.messages);
    }
  }, [guildId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadMessages(); }, [loadMessages]);

  const handleOpenCreate = () => {
    setEditingMessage(null);
    setShowModal(true);
  };

  const handleOpenEdit = (msg: ReactionRoleMessageWithMappings) => {
    setEditingMessage(msg);
    setShowModal(true);
  };

  const handleRequestDelete = (msg: ReactionRoleMessageWithMappings) => {
    setDeletingMessage(msg);
  };

  const handleConfirmDelete = async () => {
    if (!deletingMessage) return;
    setIsDeleting(true);
    const res = await deleteReactionRoleMessage(guildId, deletingMessage.id);
    setIsDeleting(false);
    if (res.success) {
      toast.success("Reaction role message deleted.");
      setMessages((prev) => prev.filter((m) => m.id !== deletingMessage.id));
      setDeletingMessage(null);
    } else {
      toast.error(res.error || "Failed to delete message.");
    }
  };

  const handleSaved = (msg: ReactionRoleMessageWithMappings) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = msg;
        return next;
      }
      return [...prev, msg];
    });
  };

  const handleUpdated = (msg: ReactionRoleMessageWithMappings) => {
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
  };

  return (
    <>
      <div className="space-y-6 animate-in fade-in-50 duration-500">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-bold tracking-tight">Reaction Roles</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Create menus where members react with an emoji to receive a Discord role.
            </p>
          </div>
          <Button
            onClick={handleOpenCreate}
            className="bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs h-8 px-4 cursor-pointer shrink-0"
          >
            <Plus className="size-3.5 mr-1.5" />
            New Message
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-zinc-400">
            <Loader2 className="size-5 animate-spin mr-2" />
            Loading reaction role messages...
          </div>
        ) : messages.length === 0 ? (
          <Card className="bg-white/60 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-850 backdrop-blur-xl border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="size-14 rounded-full bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
                <SmilePlus className="size-6 text-pink-500" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300">No reaction role messages yet</p>
                <p className="text-xs text-zinc-500">Create a message to let members self-assign roles via emoji reactions.</p>
              </div>
              <Button
                onClick={handleOpenCreate}
                className="bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs h-8 px-4 cursor-pointer mt-2"
              >
                <Plus className="size-3.5 mr-1.5" />
                Create First Message
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <MessageCard
                key={msg.id}
                guildId={guildId}
                message={msg}
                channels={channels}
                roles={roles}
                onEdit={handleOpenEdit}
                onRequestDelete={handleRequestDelete}
                onUpdated={handleUpdated}
              />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <MessageModal
          guildId={guildId}
          message={editingMessage}
          channels={channels}
          roles={roles}
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      )}

      {deletingMessage && (
        <DeleteConfirmModal
          title={deletingMessage.title}
          onClose={() => setDeletingMessage(null)}
          onConfirm={handleConfirmDelete}
          isDeleting={isDeleting}
        />
      )}
    </>
  );
}
