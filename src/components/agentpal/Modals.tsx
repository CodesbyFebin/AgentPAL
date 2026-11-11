"use client";

import { useEffect, useState } from "react";
import {
  Search,
  Plus,
  Palette,
  Sun,
  Moon,
  Sparkles,
  Bot,
  Globe,
  Image as ImageIcon,
  Keyboard,
  X,
  MessageSquare,
  Command as CommandIcon,
} from "lucide-react";
import { useStore, COMMANDS, SHORTCUTS } from "@/lib/studio/store";
import { THEMES, themeGradient } from "@/lib/studio/themes";

/* ------------------------------------------------------------------ */
/* Shared modal shell                                                  */
/* ------------------------------------------------------------------ */

function Shell({
  open,
  onClose,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,.55)", backdropFilter: "blur(6px)" }}
        onClick={onClose}
      />
      <div
        className={`glass slide-up relative w-full ${width} overflow-hidden`}
        style={{ borderRadius: 18 }}
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */

const ICONS: Record<string, typeof Plus> = {
  "New chat": Plus,
  "Artifacts mode": ImageIcon,
  "Docs search mode": Globe,
  "Chat mode": Bot,
  "Toggle Theme": Palette,
  "Light / Dark": Sun,
  "Zen Mode": Sparkles,
  "Open Shortcuts": Keyboard,
};

export function CommandPalette() {
  const {
    paletteOpen,
    setPaletteOpen,
    runCommand,
    newConversation,
    conversations,
    selectConversation,
    paletteQuery,
    setPaletteQuery,
  } = useStore();

  const close = () => setPaletteOpen(false);
  const q = paletteQuery.trim().toLowerCase();

  const matchedCmds = COMMANDS.filter((c) => (q ? c.toLowerCase().includes(q) : true));
  const matchedConvs = conversations
    .filter((c) => (q ? c.title.toLowerCase().includes(q) : true))
    .slice(0, 6);

  return (
    <Shell open={paletteOpen} onClose={close} width="max-w-xl">
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
        <Search size={16} style={{ color: "var(--muted)" }} />
        <input
          autoFocus
          value={paletteQuery}
          onChange={(e) => setPaletteQuery(e.target.value)}
          placeholder="Search commands and chats…"
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: "var(--text)" }}
        />
        <kbd className="mono rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
          esc
        </kbd>
      </div>
      <div className="scroll-thin max-h-[60vh] overflow-y-auto p-2">
        {/* New chat */}
        <button
          onClick={() => {
            newConversation();
            close();
          }}
          className="grad-btn flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
          style={{ background: "linear-gradient(120deg, var(--accent), var(--accent2))" }}
        >
          <Plus size={15} /> New chat
        </button>

        <div className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          Commands
        </div>
        {matchedCmds.map((c) => {
          const Icon = ICONS[c] || CommandIcon;
          return (
            <button
              key={c}
              onClick={() => runCommand(c)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/5"
              style={{ color: "var(--text)" }}
            >
              <Icon size={15} style={{ color: "var(--muted)" }} />
              {c}
            </button>
          );
        })}

        {matchedConvs.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Chats
            </div>
            {matchedConvs.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  selectConversation(c.id);
                  close();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/5"
                style={{ color: "var(--text)" }}
              >
                <MessageSquare size={15} style={{ color: "var(--muted)" }} />
                <span className="truncate">{c.title}</span>
              </button>
            ))}
          </>
        )}
        {matchedCmds.length === 0 && matchedConvs.length === 0 && (
          <div className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
            No matches.
          </div>
        )}
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Shortcuts modal                                                     */
/* ------------------------------------------------------------------ */

export function ShortcutsModal() {
  const { shortcutsOpen, setShortcutsOpen } = useStore();
  return (
    <Shell open={shortcutsOpen} onClose={() => setShortcutsOpen(false)}>
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
        <Keyboard size={16} style={{ color: "var(--accent)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Keyboard shortcuts
        </span>
        <button onClick={() => setShortcutsOpen(false)} className="ml-auto" style={{ color: "var(--muted)" }} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="p-3">
        {SHORTCUTS.map((s) => (
          <div
            key={s.action}
            className="flex items-center justify-between rounded-lg px-3 py-2 text-sm"
            style={{ color: "var(--text)" }}
          >
            <span>{s.action}</span>
            <kbd className="mono rounded border px-2 py-0.5 text-[11px]" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Settings modal                                                      */
/* ------------------------------------------------------------------ */

export function SettingsModal() {
  const {
    settingsOpen,
    setSettingsOpen,
    theme,
    setTheme,
    light,
    toggleLight,
    zen,
    toggleZen,
  } = useStore();

  return (
    <Shell open={settingsOpen} onClose={() => setSettingsOpen(false)} width="max-w-lg">
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
        <Palette size={16} style={{ color: "var(--accent)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Settings
        </span>
        <button onClick={() => setSettingsOpen(false)} className="ml-auto" style={{ color: "var(--muted)" }} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="scroll-thin max-h-[70vh] overflow-y-auto p-4">
        {/* themes */}
        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          Theme
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.name}
              onClick={() => setTheme(t.name)}
              className="flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-all"
              style={{
                borderColor: theme === t.name ? "var(--accent)" : "var(--line)",
                background: "var(--glass)",
              }}
            >
              <span
                className="h-8 w-full rounded-lg"
                style={{ background: themeGradient(t) }}
              />
              <span className="text-[10px] font-medium" style={{ color: "var(--text)" }}>
                {t.name}
              </span>
            </button>
          ))}
        </div>

        {/* toggles */}
        <div className="mt-4 space-y-1">
          <ToggleRow
            label="Light mode"
            desc="Bright, daytime palette"
            on={light}
            onToggle={toggleLight}
            icon={light ? Sun : Moon}
          />
          <ToggleRow
            label="Zen mode"
            desc="Hide side panels for focus"
            on={zen}
            onToggle={toggleZen}
            icon={Sparkles}
          />
        </div>
      </div>
    </Shell>
  );
}

function ToggleRow({
  label,
  desc,
  on,
  onToggle,
  icon: Icon,
}: {
  label: string;
  desc: string;
  on: boolean;
  onToggle: () => void;
  icon: typeof Sun;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: "var(--line)", background: "var(--glass)" }}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: "var(--bg)", color: "var(--muted)" }}>
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
          {label}
        </div>
        <div className="text-[11px]" style={{ color: "var(--muted)" }}>
          {desc}
        </div>
      </div>
      <button
        onClick={onToggle}
        className="apal-switch"
        data-on={on}
        aria-label={label}
        aria-pressed={on}
      />
    </div>
  );
}
