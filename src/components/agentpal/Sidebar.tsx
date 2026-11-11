"use client";

import { useState } from "react";
import {
  Plus,
  MessageSquare,
  Pin,
  PinOff,
  Trash2,
  Pencil,
  Check,
  Search,
  Sparkles,
} from "lucide-react";
import { useStore } from "@/lib/studio/store";
import { themeGradient } from "@/lib/studio/themes";
import { THEMES } from "@/lib/studio/themes";

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ConvItem({ id, title, pinned, updatedAt }: { id: string; title: string; pinned: boolean; updatedAt: number }) {
  const { activeConversationId, selectConversation, deleteConversation, togglePin, renameConversation } =
    useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const active = activeConversationId === id;

  const commit = () => {
    const t = draft.trim();
    if (t && t !== title) renameConversation(id, t);
    setEditing(false);
  };

  return (
    <div
      className={`group flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition-colors ${
        active ? "" : "hover:bg-white/5"
      }`}
      style={{
        background: active ? "var(--glass)" : "transparent",
        border: active ? "1px solid var(--line)" : "1px solid transparent",
        color: "var(--text)",
      }}
    >
      <MessageSquare size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: "var(--text)" }}
        />
      ) : (
        <button
          onClick={() => selectConversation(id)}
          className="flex-1 truncate text-left"
          title={title}
        >
          {title}
        </button>
      )}
      <span className="mono shrink-0 text-[10px]" style={{ color: "var(--muted)" }}>
        {timeAgo(updatedAt)}
      </span>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
        {editing ? (
          <button onClick={commit} aria-label="Save name" className="p-1" style={{ color: "var(--muted)" }}>
            <Check size={13} />
          </button>
        ) : (
          <>
            <button
              onClick={() => togglePin(id)}
              aria-label={pinned ? "Unpin" : "Pin"}
              className="p-1"
              style={{ color: pinned ? "var(--accent)" : "var(--muted)" }}
            >
              {pinned ? <Pin size={13} /> : <PinOff size={13} />}
            </button>
            <button
              onClick={() => setEditing(true)}
              aria-label="Rename"
              className="p-1"
              style={{ color: "var(--muted)" }}
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => deleteConversation(id)}
              aria-label="Delete"
              className="p-1"
              style={{ color: "var(--muted)" }}
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Sidebar() {
  const {
    conversations,
    newConversation,
    search,
    setSearch,
    theme,
    loadedConversations,
  } = useStore();
  const t = THEMES.find((x) => x.name === theme)!;

  const q = search.trim().toLowerCase();
  const filtered = conversations.filter((c) =>
    q ? c.title.toLowerCase().includes(q) : true
  );
  const pinned = filtered.filter((c) => c.pinned);
  const rest = filtered.filter((c) => !c.pinned);

  return (
    <aside
      className="hidden w-[260px] shrink-0 flex-col border-r lg:flex"
      style={{ borderColor: "var(--line)", background: "var(--bg2)" }}
    >
      {/* New chat */}
      <div className="p-3">
        <button
          onClick={newConversation}
          className="grad-btn flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold"
          style={{ background: themeGradient(t) }}
        >
          <Plus size={16} /> New chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div
          className="flex items-center gap-2 rounded-xl border px-3 py-2"
          style={{ borderColor: "var(--line)", background: "var(--glass)" }}
        >
          <Search size={14} style={{ color: "var(--muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: "var(--text)" }}
          />
        </div>
      </div>

      {/* List */}
      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
        {!loadedConversations ? (
          <div className="space-y-2 px-1">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-9 rounded-xl"
                style={{ background: "var(--glass)" }}
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs" style={{ color: "var(--muted)" }}>
            {q ? "No chats match your search." : "No conversations yet. Start a new chat!"}
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Pinned
              </div>
            )}
            {pinned.map((c) => (
              <ConvItem key={c.id} id={c.id} title={c.title} pinned={c.pinned} updatedAt={c.updatedAt} />
            ))}
            {pinned.length > 0 && rest.length > 0 && (
              <div className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Recent
              </div>
            )}
            {rest.map((c) => (
              <ConvItem key={c.id} id={c.id} title={c.title} pinned={c.pinned} updatedAt={c.updatedAt} />
            ))}
          </>
        )}
      </div>

      {/* Footer brand */}
      <div
        className="border-t p-3 text-[11px]"
        style={{ borderColor: "var(--line)", color: "var(--muted)" }}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={13} style={{ color: "var(--accent)" }} />
          <span className="mono">AgentPaL · coach · artifacts · PayPal docs</span>
        </div>
      </div>
    </aside>
  );
}
