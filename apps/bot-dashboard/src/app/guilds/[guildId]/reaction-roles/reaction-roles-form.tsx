"use client";

import React, { useState, useEffect, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  createReactionRoleMessage,
  updateReactionRoleMessage,
  deleteReactionRoleMessage,
  ReactionRoleMessageRecord,
  ReactionRoleMappingPayload,
} from "@/actions/guilds";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  Smile,
  Hash,
  ShieldCheck,
  Sparkles,
  Search,
  MessageSquare,
  ChevronRight,
  Eye,
  Info,
  Check,
  AlertCircle,
  HelpCircle,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

interface DiscordRole {
  id: string;
  name: string;
  color: number;
}

interface ReactionRolesFormProps {
  guildId: string;
  initialMessages: ReactionRoleMessageRecord[];
  channels: DiscordChannel[];
  roles: DiscordRole[];
}

/** Formats a Discord role colour integer as a CSS hex string. */
function roleColor(color: number): string {
  if (!color) return "#94a3b8";
  return `#${color.toString(16).padStart(6, "0")}`;
}

const EMOJI_PRESETS = [
  "📌",
  "🔔",
  "⚔️",
  "🛡️",
  "🎯",
  "🚀",
  "💬",
  "🎮",
  "🏆",
  "💎",
  "📢",
  "🎁",
  "✨",
  "🔥",
  "⚡",
  "⭐",
];

export function ReactionRolesForm({
  guildId,
  initialMessages,
  channels,
  roles,
}: ReactionRolesFormProps) {
  const [messages, setMessages] = useState<ReactionRoleMessageRecord[]>(initialMessages);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChannelFilter, setSelectedChannelFilter] = useState<string>("all");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isModalOpen]);

  // Form Fields
  const [title, setTitle] = useState("");
  const [channelId, setChannelId] = useState("");
  const [requiredRoleId, setRequiredRoleId] = useState<string>("");
  const [mappings, setMappings] = useState<ReactionRoleMappingPayload[]>([
    { emoji: "📌", roleId: "", description: "" },
  ]);

  const [isPending, startTransition] = useTransition();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Open modal for creating new message
  const handleOpenCreateModal = () => {
    setEditingMessageId(null);
    setTitle("");
    setChannelId(channels[0]?.id || "");
    setRequiredRoleId("");
    setMappings([
      { emoji: "📌", roleId: "", description: "General updates & announcements" },
      { emoji: "🔔", roleId: "", description: "Event notifications" },
    ]);
    setIsModalOpen(true);
  };

  // Open modal for editing existing message
  const handleOpenEditModal = (msg: ReactionRoleMessageRecord) => {
    setEditingMessageId(msg.id);
    setTitle(msg.title);
    setChannelId(msg.channelId);
    setRequiredRoleId(msg.requiredRoleId || "");
    setMappings(
      msg.mappings.length > 0
        ? msg.mappings.map((m) => ({
          id: m.id,
          emoji: m.emoji,
          roleId: m.roleId,
          description: m.description || "",
        }))
        : [{ emoji: "📌", roleId: "", description: "" }],
    );
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingMessageId(null);
  };

  // Add mapping row
  const handleAddMappingRow = () => {
    const nextPreset = EMOJI_PRESETS[mappings.length % EMOJI_PRESETS.length] || "📌";
    setMappings((prev) => [
      ...prev,
      { emoji: nextPreset, roleId: "", description: "" },
    ]);
  };

  // Remove mapping row
  const handleRemoveMappingRow = (index: number) => {
    if (mappings.length <= 1) {
      toast.error("Reaction menus must have at least one emoji role binding.");
      return;
    }
    setMappings((prev) => prev.filter((_, i) => i !== index));
  };

  // Update mapping row field
  const handleUpdateMapping = (
    index: number,
    field: keyof ReactionRoleMappingPayload,
    value: string,
  ) => {
    setMappings((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  // Submit modal form
  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.error("Please enter a title for the reaction role menu.");
      return;
    }
    if (!channelId) {
      toast.error("Please select a target channel to post the reaction menu.");
      return;
    }

    // Validate mappings
    const validMappings = mappings.filter((m) => m.emoji.trim() && m.roleId.trim());
    if (validMappings.length === 0) {
      toast.error("Please assign a Discord role for at least one emoji.");
      return;
    }

    // Check duplicate emojis
    const emojis = validMappings.map((m) => m.emoji.trim());
    if (new Set(emojis).size !== emojis.length) {
      toast.error("Each emoji in a reaction menu must be unique.");
      return;
    }

    const payload = {
      title: title.trim(),
      channelId,
      requiredRoleId: requiredRoleId || null,
      mappings: validMappings.map((m) => ({
        emoji: m.emoji.trim(),
        roleId: m.roleId.trim(),
        description: m.description?.trim() || null,
      })),
    };

    startTransition(async () => {
      if (editingMessageId) {
        const res = await updateReactionRoleMessage(guildId, editingMessageId, payload);
        if (res.success && res.message) {
          toast.success("Reaction role menu updated successfully!");
          setMessages((prev) =>
            prev.map((m) => (m.id === editingMessageId ? (res.message as ReactionRoleMessageRecord) : m)),
          );
          handleCloseModal();
        } else {
          toast.error(res.error || "Failed to update reaction role menu.");
        }
      } else {
        const res = await createReactionRoleMessage(guildId, payload);
        if (res.success && res.message) {
          toast.success("Reaction role menu created successfully!");
          setMessages((prev) => [res.message as ReactionRoleMessageRecord, ...prev]);
          handleCloseModal();
        } else {
          toast.error(res.error || "Failed to create reaction role menu.");
        }
      }
    });
  };

  // Delete message
  const handleDelete = (msg: ReactionRoleMessageRecord) => {
    startTransition(async () => {
      const res = await deleteReactionRoleMessage(guildId, msg.id, msg.title);
      if (res.success) {
        toast.success(`Deleted "${msg.title}" reaction menu.`);
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
        setDeleteConfirmId(null);
      } else {
        toast.error(res.error || "Failed to delete reaction role menu.");
      }
    });
  };

  // Filtering
  const filteredMessages = messages.filter((msg) => {
    const matchesSearch =
      msg.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      msg.mappings.some((m) => {
        const r = roles.find((role) => role.id === m.roleId);
        return (
          m.emoji.includes(searchQuery) ||
          (r && r.name.toLowerCase().includes(searchQuery.toLowerCase()))
        );
      });

    const matchesChannel =
      selectedChannelFilter === "all" || msg.channelId === selectedChannelFilter;

    return matchesSearch && matchesChannel;
  });

  const totalBindings = messages.reduce((acc, m) => acc + m.mappings.length, 0);

  return (
    <div className="space-y-8">


      {/* Control Bar: Search, Channel Filter & Add Button */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-3xl bg-[#0c111d] border border-slate-800/80 shadow-lg">
        <div className="flex flex-1 flex-col sm:flex-row items-center gap-3">
          {/* Search Input */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search menus or roles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-900/80 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Channel Filter Dropdown */}
          <div className="relative w-full sm:w-56">
            <select
              value={selectedChannelFilter}
              onChange={(e) => setSelectedChannelFilter(e.target.value)}
              className="w-full appearance-none pl-4 pr-10 py-2.5 rounded-2xl bg-slate-900/80 border border-slate-800 text-sm text-slate-300 focus:outline-none focus:border-amber-500/50 transition-colors cursor-pointer"
            >
              <option value="all">All Target Channels</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  #{ch.name}
                </option>
              ))}
            </select>
            <Hash className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
        </div>

        {/* Create Button */}
        <button
          type="button"
          onClick={handleOpenCreateModal}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-amber-500 text-slate-950 font-extrabold text-sm shadow-lg shadow-amber-500/20 hover:bg-amber-400 transition-all shrink-0 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          New Reaction Role Menu
        </button>
      </div>

      {/* Reaction Role Message Cards Grid */}
      {filteredMessages.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-[#0c111d] border border-slate-800/80 space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto shadow-inner">
            <Smile className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">No Reaction Role Menus Found</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              {searchQuery || selectedChannelFilter !== "all"
                ? "No reaction role menus match your search criteria. Try adjusting your search query or filter."
                : "Get started by creating your first interactive reaction role menu for members to self-assign roles."}
            </p>
          </div>
          {!searchQuery && selectedChannelFilter === "all" && (
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-amber-500 text-slate-950 font-bold text-sm hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/20"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              Create Reaction Role Menu
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredMessages.map((msg) => {
            const channel = channels.find((c) => c.id === msg.channelId);
            const reqRole = roles.find((r) => r.id === msg.requiredRoleId);

            return (
              <div
                key={msg.id}
                className="rounded-3xl bg-[#0c111d] border border-slate-800/80 p-6 space-y-5 shadow-xl hover:border-slate-700/80 transition-all flex flex-col justify-between group"
              >
                <div className="space-y-4">
                  {/* Card Top Banner */}
                  <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800/80">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-300 text-xs font-mono font-semibold inline-flex items-center gap-1">
                          <Hash className="w-3 h-3 text-amber-400" />
                          {channel ? channel.name : msg.channelId}
                        </span>
                        {msg.requiredRoleId && (
                          <span
                            className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-mono font-semibold inline-flex items-center gap-1"
                            title={`Requires role: @${reqRole ? reqRole.name : msg.requiredRoleId}`}
                          >
                            <ShieldCheck className="w-3 h-3 text-amber-400" />
                            Gated: @{reqRole ? reqRole.name : msg.requiredRoleId}
                          </span>
                        )}
                      </div>
                      <h3 className="text-xl font-extrabold text-white tracking-tight leading-snug">
                        {msg.title}
                      </h3>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(msg)}
                        className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-amber-500/40 hover:bg-amber-500/10 transition-all cursor-pointer"
                        title="Edit Menu"
                      >
                        <Pencil className="w-4 h-4 text-amber-400" />
                      </button>
                      {deleteConfirmId === msg.id ? (
                        <div className="flex items-center gap-1 bg-red-500/10 border border-red-500/30 rounded-xl p-1 animate-in fade-in zoom-in duration-150">
                          <button
                            type="button"
                            onClick={() => handleDelete(msg)}
                            disabled={isPending}
                            className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition-colors cursor-pointer flex items-center gap-1"
                          >
                            {isPending ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              "Confirm"
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(null)}
                            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(msg.id)}
                          className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-all cursor-pointer"
                          title="Delete Menu"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Emoji Mapping List */}
                  <div className="space-y-2.5">
                    <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider font-semibold block">
                      Role Bindings ({msg.mappings.length})
                    </span>
                    <div className="space-y-2">
                      {msg.mappings.map((m, idx) => {
                        const targetRole = roles.find((r) => r.id === m.roleId);
                        return (
                          <div
                            key={m.id || idx}
                            className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-lg w-8 h-8 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center shrink-0">
                                {m.emoji}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  {targetRole && (
                                    <span
                                      className="w-2.5 h-2.5 rounded-full shrink-0"
                                      style={{ backgroundColor: roleColor(targetRole.color) }}
                                    />
                                  )}
                                  <span className="text-xs font-mono font-bold text-white truncate">
                                    @{targetRole ? targetRole.name : m.roleId}
                                  </span>
                                </div>
                                {m.description && (
                                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                    {m.description}
                                  </p>
                                )}
                              </div>
                            </div>
                            <span className="text-[10px] font-mono text-slate-500 bg-slate-800/50 px-2 py-1 rounded-md shrink-0">
                              Reaction Toggle
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Footer status */}
                <div className="pt-3 border-t border-slate-800/50 flex items-center justify-between text-xs text-slate-500 font-mono">
                  <span>
                    Status: {msg.messageId ? "Synced to Discord" : "Pending Bot Sync"}
                  </span>
                  {msg.messageId && (
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-semibold">
                      Live Embed Active
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE / EDIT REACTION ROLE MODAL */}
      {mounted && isModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
          <div className="w-full max-w-5xl rounded-3xl bg-[#0c111d] border border-slate-800 shadow-2xl overflow-hidden my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800 bg-slate-900/40">
              <div className="flex items-center gap-3">

                <div>
                  <h2 className="text-xl font-extrabold text-white tracking-tight">
                    {editingMessageId
                      ? "Edit Reaction Role Menu"
                      : "Create New Reaction Role Menu"}
                  </h2>

                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseModal}
                className="p-2 rounded-2xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content: Grid Layout with Form on Left, Live Discord Preview on Right */}
            <form onSubmit={handleSubmitForm}>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 p-6 lg:p-8 max-h-[75vh] overflow-y-auto">
                {/* Left Side: Form Controls (7 cols) */}
                <div className="lg:col-span-7 space-y-6">
                  {/* Title Input */}
                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider font-semibold text-slate-300">
                      Message Title <span className="text-amber-400">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Roles & Notifications"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                      className="w-full px-4 py-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50 transition-colors font-medium"
                    />
                    <p className="text-[11px] text-slate-500">
                      This will be displayed as the main title header in the Discord embed.
                    </p>
                  </div>

                  {/* Channel Selection */}
                  <div className="space-y-2">
                    <label className="block text-xs font-mono uppercase tracking-wider font-semibold text-slate-300">
                      Target Channel <span className="text-amber-400">*</span>
                    </label>
                    <div className="relative">
                      <select
                        value={channelId}
                        onChange={(e) => setChannelId(e.target.value)}
                        required
                        className="w-full appearance-none px-4 pr-10 py-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors cursor-pointer font-medium"
                      >
                        {channels.length === 0 ? (
                          <option value="">No text channels found</option>
                        ) : (
                          channels.map((ch) => (
                            <option key={ch.id} value={ch.id}>
                              {ch.name}
                            </option>
                          ))
                        )}
                      </select>
                      <Hash className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      The Discord channel where the Sentinel bot will post and maintain this reaction menu.
                    </p>
                  </div>

                  {/* Optional Required Role */}
                  <div className="space-y-2 p-4 rounded-2xl bg-slate-900/40 border border-slate-800/80">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-mono uppercase tracking-wider font-semibold text-slate-300 flex items-center gap-2">
                        Optional Required Access Role
                      </label>

                    </div>
                    <div className="relative">
                      <select
                        value={requiredRoleId}
                        onChange={(e) => setRequiredRoleId(e.target.value)}
                        className="w-full appearance-none px-4 pr-10 py-2.5 rounded-2xl bg-slate-900/80 border border-slate-800 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors cursor-pointer font-medium"
                      >
                        <option value="">-- None (Allow Any Member) --</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            @{r.name}
                          </option>
                        ))}
                      </select>
                      <ChevronRight className="w-4 h-4 rotate-90 absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      If set, members must have this role for the bot to grant or remove roles when reacting. Reactions from members without this role will be auto-removed.
                    </p>
                  </div>

                  {/* Emoji & Role Mappings Section */}
                  <div className="space-y-4 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-extrabold text-white tracking-tight">
                          Emoji Role Bindings
                        </h4>
                        <p className="text-xs text-slate-400">
                          Map each emoji reaction to a Discord server role.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddMappingRow}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 font-bold text-xs transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[3]" />
                        Add Binding
                      </button>
                    </div>

                    {/* Preset Emoji Picker Ribbon */}
                    <div className="p-3 rounded-2xl bg-slate-900/40 border border-slate-800/60 space-y-2">
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block font-semibold">
                        Quick Emoji Presets
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {EMOJI_PRESETS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => {
                              // Find first row without emoji or append
                              const emptyIdx = mappings.findIndex((m) => !m.emoji);
                              if (emptyIdx !== -1) {
                                handleUpdateMapping(emptyIdx, "emoji", emoji);
                              } else {
                                setMappings((prev) => [
                                  ...prev,
                                  { emoji, roleId: "", description: "" },
                                ]);
                              }
                            }}
                            className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-amber-500/20 border border-slate-700/60 hover:border-amber-500/40 text-base flex items-center justify-center transition-all cursor-pointer hover:scale-110 active:scale-95"
                            title={`Insert ${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Mapping Rows */}
                    <div className="space-y-3">
                      {mappings.map((m, idx) => (
                        <div
                          key={idx}
                          className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 relative group"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[11px] font-mono text-slate-400 font-bold">
                              Binding #{idx + 1}
                            </span>
                            {mappings.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveMappingRow(idx)}
                                className="p-1 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                title="Remove row"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                            {/* Emoji Input */}
                            <div className="sm:col-span-3">
                              <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1 font-semibold">
                                Emoji
                              </label>
                              <input
                                type="text"
                                placeholder="📌"
                                value={m.emoji}
                                onChange={(e) =>
                                  handleUpdateMapping(idx, "emoji", e.target.value)
                                }
                                className="w-full px-3 py-2 text-center rounded-xl bg-slate-800/80 border border-slate-700 text-lg text-white focus:outline-none focus:border-amber-500/50"
                              />
                            </div>

                            {/* Target Role Dropdown */}
                            <div className="sm:col-span-9">
                              <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1 font-semibold">
                                Target Role <span className="text-amber-400">*</span>
                              </label>
                              <select
                                value={m.roleId}
                                onChange={(e) =>
                                  handleUpdateMapping(idx, "roleId", e.target.value)
                                }
                                className="w-full appearance-none px-3 py-2 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500/50 cursor-pointer font-medium"
                              >
                                <option value="">-- Select Role --</option>
                                {roles.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    @{r.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Description Input */}
                          <div>
                            <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1 font-semibold">
                              Label / Description (Optional)
                            </label>
                            <input
                              type="text"
                              placeholder="e.g. Receive faction raid notifications"
                              value={m.description || ""}
                              onChange={(e) =>
                                handleUpdateMapping(idx, "description", e.target.value)
                              }
                              className="w-full px-3 py-1.5 rounded-xl bg-slate-800/50 border border-slate-700/60 text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Side: Live Discord Embed Preview (5 cols) */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="sticky top-0 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono uppercase tracking-wider font-semibold text-slate-300 flex items-center gap-2">
                        <Eye className="w-4 h-4 text-amber-400" />
                        Live Discord Preview
                      </span>

                    </div>

                    {/* Discord Message Embed Card Mock */}
                    <div className="rounded-3xl bg-[#313338] p-4 text-[#dbdee1] font-sans text-sm shadow-2xl border border-slate-800/60 space-y-3">
                      {/* Bot Avatar & Header */}
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-amber-500 flex items-center justify-center text-slate-950 font-extrabold text-xs shrink-0 shadow-md">
                          S
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white text-sm">
                            Sentinel
                          </span>
                          <span className="bg-[#5865f2] text-white text-[10px] font-bold px-1.5 py-0.2 rounded font-mono uppercase">
                            BOT
                          </span>
                          <span className="text-[11px] text-[#949ba4]">Today at 12:00 PM</span>
                        </div>
                      </div>

                      {/* Embed Box */}
                      <div className="ml-12 pl-3 border-l-4 border-[#3b82f6] bg-[#2b2d31] p-4 rounded-lg space-y-3">
                        <h4 className="font-bold text-white text-base">
                          {title.trim() || "Role Menu Title"}
                        </h4>

                        {/* Mappings Lines */}
                        <div className="space-y-1.5 text-xs text-[#dbdee1] font-normal leading-relaxed">
                          {mappings.length === 0 || mappings.every((m) => !m.roleId) ? (
                            <span className="text-slate-500 italic">
                              No role bindings configured yet...
                            </span>
                          ) : (
                            mappings.map((m, idx) => {
                              const r = roles.find((role) => role.id === m.roleId);
                              const roleName = r ? `@${r.name}` : "@Role";
                              const descStr = m.description ? ` — ${m.description}` : "";
                              return (
                                <div key={idx} className="flex items-start gap-1.5">
                                  <span>{m.emoji || "📌"}</span>
                                  <span>—</span>
                                  <span className="bg-[#35363c] text-[#c9cdfb] px-1 rounded font-mono">
                                    {roleName}
                                  </span>
                                  <span className="text-slate-400">{descStr}</span>
                                </div>
                              );
                            })
                          )}
                        </div>

                        {/* Required Role Field if set */}
                        {requiredRoleId && (
                          <div className="pt-2 border-t border-[#3f4147] space-y-1">
                            <span className="text-[11px] font-bold uppercase text-slate-400 block">
                              Required Role
                            </span>
                            <span className="bg-[#35363c] text-[#c9cdfb] px-1 rounded font-mono text-xs">
                              @{roles.find((r) => r.id === requiredRoleId)?.name || "RequiredRole"}
                            </span>
                          </div>
                        )}

                        {/* Embed Footer */}
                        <div className="pt-2 flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                          <span>Sentinel</span>
                          <span>•</span>
                          <span>Auto-deletes feedback in 10s</span>
                        </div>
                      </div>

                      {/* Discord Reaction Chips Mock */}
                      <div className="ml-12 flex flex-wrap gap-1.5 pt-1">
                        {mappings
                          .filter((m) => m.emoji)
                          .map((m, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded-lg bg-[#2b2d31] hover:bg-[#35363c] border border-[#3f4147] text-xs flex items-center gap-1 text-[#dbdee1] font-medium cursor-default"
                            >
                              <span>{m.emoji}</span>
                              <span className="text-[11px] text-slate-400 font-mono">1</span>
                            </span>
                          ))}
                      </div>
                    </div>


                  </div>
                </div>
              </div>

              {/* Modal Footer Buttons */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800 bg-slate-900/40">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-5 py-2.5 rounded-2xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white font-bold text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-2xl bg-amber-500 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/20 hover:bg-amber-400 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                >
                  {isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 stroke-[3]" />
                  )}
                  {editingMessageId ? "Save Changes" : "Create Reaction Menu"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
