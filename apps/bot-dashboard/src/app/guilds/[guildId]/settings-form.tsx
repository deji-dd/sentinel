"use client";

import React, { useState, useTransition } from "react";
import {
  updateGuildGeneralSettings,
  addGuildApiKey,
  deleteGuildApiKey,
} from "@/actions/guilds";
import {
  Save,
  Key,
  Trash2,
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

interface GuildSettingsFormProps {
  guildId: string;
  guildName: string;
  initialConfig: {
    logChannelId: string | null;
    adminRoleIds: string[];
    apiKeys: {
      id: string;
      providedBy: string | null;
      isValid: boolean;
      createdAt: Date;
    }[];
  };
  channels: { id: string; name: string; type: number }[];
  roles: { id: string; name: string; color: number }[];
}

export function GuildSettingsForm({
  guildId,
  guildName,
  initialConfig,
  channels,
  roles,
}: GuildSettingsFormProps) {
  const initialLogChannel = initialConfig.logChannelId || "";
  const initialAdminRoles = initialConfig.adminRoleIds || [];

  const [logChannelId, setLogChannelId] = useState(initialLogChannel);
  const [adminRoles, setAdminRoles] = useState<string[]>(initialAdminRoles);
  const [roleInput, setRoleInput] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [isSaving, startSaving] = useTransition();
  const [isAddingKey, startAddingKey] = useTransition();
  const [isDeletingKey, setIsDeletingKey] = useState<string | null>(null);

  const isDirty =
    logChannelId !== initialLogChannel ||
    JSON.stringify(adminRoles) !== JSON.stringify(initialAdminRoles);

  const handleDiscard = () => {
    setLogChannelId(initialLogChannel);
    setAdminRoles(initialAdminRoles);
    toast.info("Unsaved changes discarded.");
  };

  const handleSaveSettings = () => {
    startSaving(async () => {
      const res = await updateGuildGeneralSettings(guildId, {
        logChannelId: logChannelId || null,
        adminRoleIds: adminRoles,
      });

      if (res.success) {
        toast.success("Settings saved successfully!");
      } else {
        toast.error(res.error || "Failed to save settings.");
      }
    });
  };

  const handleAddRole = (roleIdToAdd: string) => {
    if (!roleIdToAdd) return;
    if (adminRoles.includes(roleIdToAdd)) {
      toast.warning("Role is already added.");
      return;
    }
    setAdminRoles([...adminRoles, roleIdToAdd]);
    setRoleInput("");
  };

  const handleRemoveRole = (roleIdToRemove: string) => {
    setAdminRoles(adminRoles.filter((id) => id !== roleIdToRemove));
  };

  const handleAddApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKey = newApiKey.trim();

    if (!trimmedKey) {
      toast.error("Please enter a Torn API key.");
      return;
    }

    if (!/^[a-zA-Z0-9]{16}$/.test(trimmedKey)) {
      toast.error("Torn API key must be strictly 16 alphanumeric characters.");
      return;
    }

    startAddingKey(async () => {
      const res = await addGuildApiKey(guildId, trimmedKey);
      if (res.success) {
        toast.success("Guild API key added successfully!");
        setNewApiKey("");
      } else {
        toast.error(res.error || "Failed to add API key.");
      }
    });
  };

  const handleDeleteKey = async (keyId: string) => {
    setIsDeletingKey(keyId);
    try {
      const res = await deleteGuildApiKey(guildId, keyId);
      if (res.success) {
        toast.success("API key deleted.");
      } else {
        toast.error(res.error || "Failed to delete key.");
      }
    } finally {
      setIsDeletingKey(null);
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Log Channel Settings Section */}
      <section className="p-6 lg:p-8 rounded-3xl bg-[#0c111d] border border-slate-800/80 space-y-6 shadow-xl relative overflow-hidden">
        <div className="flex items-center gap-3.5 pb-4 border-b border-slate-800/80">
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              Audit Log Channel
            </h2>
          </div>
        </div>

        <div className="space-y-3 flex flex-col">
          <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-slate-400">
            Target Discord Channel
          </label>

          {channels.length > 0 ? (
            <select
              value={logChannelId}
              onChange={(e) => setLogChannelId(e.target.value)}
              className="w-full max-w-md h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-sans focus:outline-none focus:border-blue-500/50 transition-colors cursor-pointer"
            >
              <option value="">-- No Audit Log Channel Selected --</option>
              {channels
                .filter((c) => c.type === 0)
                .map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
            </select>
          ) : (
            <input
              type="text"
              value={logChannelId}
              onChange={(e) => setLogChannelId(e.target.value)}
              placeholder="Enter Discord Channel ID (e.g. 1096243613681332328)"
              className="w-full max-w-md h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-mono focus:outline-none focus:border-blue-500/50 transition-colors"
            />
          )}

          {logChannelId && (
            <div className="mt-3 w-fit inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 font-mono">
              <span className="text-slate-500">SELECTED:</span>
              <span className="text-blue-400 font-bold">
                {channels.find((c) => c.id === logChannelId)?.name || logChannelId}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Admin Roles Settings Section */}
      <section className="p-6 lg:p-8 rounded-3xl bg-[#0c111d] border border-slate-800/80 space-y-6 shadow-xl relative overflow-hidden">
        <div className="flex items-center gap-3.5 pb-4 border-b border-slate-800/80">
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              Administrator Roles
            </h2>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2.5 max-w-md">
            {roles.length > 0 ? (
              <select
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value)}
                className="flex-1 h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-sans focus:outline-none focus:border-purple-500/50 transition-colors cursor-pointer"
              >
                <option value="">-- Select Role to Add --</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value)}
                placeholder="Enter Discord Role ID"
                className="flex-1 h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-mono focus:outline-none focus:border-purple-500/50 transition-colors"
              />
            )}
            <button
              type="button"
              onClick={() => handleAddRole(roleInput)}
              className="h-11 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-purple-600/20 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add Role
            </button>
          </div>

          {/* Admin Role Tags List */}
          <div className="flex flex-wrap gap-2 pt-2">
            {adminRoles.length === 0 ? (
              <div className="p-3.5 rounded-2xl bg-slate-900/50 border border-slate-800/60 text-xs text-slate-500 italic w-full">
                No custom admin roles assigned. Server owner and Discord Administrators have default access.
              </div>
            ) : (
              adminRoles.map((roleId) => {
                const roleObj = roles.find((r) => r.id === roleId);
                const roleName = roleObj ? `@${roleObj.name}` : roleId;

                return (
                  <span
                    key={roleId}
                    className="inline-flex items-center gap-2 py-1.5 px-3.5 rounded-xl bg-purple-600/10 border border-purple-500/30 text-purple-300 text-xs font-medium font-mono"
                  >
                    <span>{roleName}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveRole(roleId)}
                      className="p-0.5 rounded-md hover:bg-purple-500/20 text-purple-400 hover:text-red-400 transition-colors cursor-pointer"
                      title="Remove Role"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* API Keys Settings Section */}
      <section className="p-6 lg:p-8 rounded-3xl bg-[#0c111d] border border-slate-800/80 space-y-6 shadow-xl relative overflow-hidden">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-3.5">
            <div>
              <h2 className="text-lg font-extrabold text-white tracking-tight">
                Guild API Credentials
              </h2>
            </div>
          </div>
        </div>

        {/* Add Key Form */}
        <form onSubmit={handleAddApiKey} className="flex gap-2.5 max-w-md">
          <input
            type="password"
            value={newApiKey}
            onChange={(e) => setNewApiKey(e.target.value)}
            maxLength={16}
            placeholder="Enter 16-character Torn API Key..."
            className="flex-1 h-11 py-2.5 px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-white text-sm font-mono focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
          <button
            type="submit"
            disabled={isAddingKey}
            className="h-11 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-emerald-600/20 cursor-pointer shrink-0"
          >
            {isAddingKey ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Register Key
          </button>
        </form>

        {/* Existing API Keys List */}
        <div className="space-y-3">
          {initialConfig.apiKeys.length === 0 ? (
            <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/60 text-xs text-slate-500 text-center italic">
              No Torn API keys registered for this server yet. Add a valid key above to enable background operations.
            </div>
          ) : (
            initialConfig.apiKeys.map((key) => (
              <div
                key={key.id}
                className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-4 text-xs"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  {key.isValid ? (
                    <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                  ) : (
                    <div className="p-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 shrink-0">
                      <AlertCircle className="w-4 h-4" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-200 font-bold block tracking-widest text-xs">
                        ••••••••••••••••
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${
                          key.isValid
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}
                      >
                        {key.isValid ? "VALID" : "INVALID"}
                      </span>
                    </div>
                    <span className="text-slate-500 text-[11px] block mt-0.5 truncate">
                      Provided by: {key.providedBy || "System Admin"} • Added {new Date(key.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteKey(key.id)}
                  disabled={isDeletingKey === key.id}
                  className="p-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all cursor-pointer shrink-0"
                  title="Delete API Key"
                >
                  {isDeletingKey === key.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Unified Save / Discard Page Footer */}
      <div className="pt-6 border-t border-slate-800/80 flex items-center justify-between gap-4">
        <div className="text-xs text-slate-400 font-mono">
          {isDirty ? (
            <span className="text-amber-400 flex items-center gap-2 font-semibold">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Unsaved changes pending
            </span>
          ) : (
            <span className="text-slate-500">All settings saved</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {isDirty && (
            <button
              type="button"
              onClick={handleDiscard}
              disabled={isSaving}
              className="h-11 py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Discard Changes
            </button>
          )}

          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={isSaving || !isDirty}
            className="h-11 py-2.5 px-6 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-blue-600/25 cursor-pointer"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving Changes...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
