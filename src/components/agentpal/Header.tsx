"use client";

import {
  Command,
  Moon,
  Sun,
  PanelLeft,
  Sparkles,
  Palette,
  Settings as SettingsIcon,
} from "lucide-react";
import { useStore } from "@/lib/studio/store";
import { THEMES, themeGradient } from "@/lib/studio/themes";

export default function Header() {
  const {
    theme,
    light,
    zen,
    setPaletteOpen,
    setMobileSidebar,
    setSettingsOpen,
    cycleTheme,
    toggleLight,
    toggleZen,
  } = useStore();

  const t = THEMES.find((x) => x.name === theme)!;

  return (
    <header
      className="sticky top-0 z-40 w-full border-b backdrop-blur-xl"
      style={{
        background: light ? "rgba(237,237,245,.72)" : "rgba(7,9,19,.72)",
        borderColor: "var(--line)",
      }}
    >
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 sm:gap-3 sm:px-5">
        {/* mobile sidebar trigger */}
        <button
          onClick={() => setMobileSidebar(true)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border lg:hidden"
          style={{
            borderColor: "var(--line)",
            background: "var(--glass)",
            color: "var(--text)",
          }}
          aria-label="Open conversations"
        >
          <PanelLeft size={16} />
        </button>

        {/* Brand */}
        <button
          onClick={() => useStore.getState().newConversation()}
          className="flex items-center gap-2"
          aria-label="AgentPaL home"
        >
          <span
            className="grid h-8 w-8 place-items-center rounded-xl text-white"
            style={{ background: themeGradient(t) }}
          >
            <Sparkles size={16} />
          </span>
          <span className="text-[17px] font-bold tracking-tight" style={{ color: "var(--text)" }}>
            Agent<span className="shimmer-text">PAL</span>
          </span>
        </button>

        <span
          className="hidden items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold md:inline-flex"
          style={{
            color: "var(--muted)",
            borderColor: "var(--line)",
            border: "1px solid var(--line)",
          }}
        >
          <span className="dot" /> your AI pal
        </span>

        {/* spacer */}
        <div className="flex-1" />

        {/* Right controls */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs sm:flex"
          style={{
            borderColor: "var(--line)",
            background: "var(--glass)",
            color: "var(--muted)",
          }}
          title="Command palette (⌘K)"
        >
          <Command size={13} />
          <span>Search…</span>
          <kbd
            className="mono rounded border px-1 py-0.5 text-[9px]"
            style={{ borderColor: "var(--line)" }}
          >
            ⌘K
          </kbd>
        </button>

        <button
          onClick={() => setPaletteOpen(true)}
          className="grid h-9 w-9 place-items-center rounded-full border sm:hidden"
          style={{
            borderColor: "var(--line)",
            background: "var(--glass)",
            color: "var(--text)",
          }}
          aria-label="Command palette"
        >
          <Command size={16} />
        </button>

        {/* Theme cycle */}
        <button
          onClick={cycleTheme}
          className="h-8 w-8 rounded-full border"
          style={{ background: themeGradient(t), borderColor: "var(--line)" }}
          aria-label="Cycle theme"
          title={`Theme: ${theme}`}
        />
        <button
          onClick={toggleLight}
          className="grid h-9 w-9 place-items-center rounded-full border"
          style={{
            borderColor: "var(--line)",
            background: "var(--glass)",
            color: "var(--text)",
          }}
          aria-label="Toggle light/dark"
          title="Toggle light / dark"
        >
          {light ? <Moon size={16} /> : <Sun size={16} />}
        </button>
        <button
          onClick={toggleZen}
          className="hidden h-9 w-9 place-items-center rounded-full border sm:grid"
          style={{
            borderColor: "var(--line)",
            background: zen ? "var(--accent)" : "var(--glass)",
            color: zen ? "#fff" : "var(--text)",
          }}
          aria-label="Toggle zen mode"
          title="Zen mode"
        >
          <Palette size={16} />
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="grid h-9 w-9 place-items-center rounded-full border"
          style={{
            borderColor: "var(--line)",
            background: "var(--glass)",
            color: "var(--text)",
          }}
          aria-label="Settings"
          title="Settings"
        >
          <SettingsIcon size={16} />
        </button>
      </div>
    </header>
  );
}
