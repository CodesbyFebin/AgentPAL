"use client";

import { useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Image as ImageIcon,
  Globe,
  Square,
  Sparkles,
} from "lucide-react";
import { useStore, type ComposerMode } from "@/lib/studio/store";
import { themeGradient } from "@/lib/studio/themes";
import { THEMES } from "@/lib/studio/themes";

const MODES: { id: ComposerMode; label: string; icon: typeof Bot; hint: string }[] = [
  { id: "chat", label: "Chat", icon: Bot, hint: "Talk with Pal" },
  { id: "imagine", label: "Artifacts", icon: ImageIcon, hint: "Create a sandboxed visual or code artifact" },
  { id: "search", label: "PayPal Docs", icon: Globe, hint: "Search official PayPal resources" },
];

const PLACEHOLDERS: Record<ComposerMode, string> = {
  chat: "Ask the AgentPaL Money Coach…",
  imagine: "Describe an artifact to build…",
  search: "Search PayPal developer resources…",
};

export default function Composer() {
  const {
    composer,
    setComposer,
    composerMode,
    setComposerMode,
    sendMessage,
    sendImagine,
    streaming,
    stopStreaming,
    theme,
  } = useStore();
  const t = THEMES.find((x) => x.name === theme)!;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  const submit = () => {
    const text = composer.trim();
    if (!text || streaming) return;
    if (composerMode === "imagine") sendImagine(text);
    else sendMessage(text);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // auto-grow textarea
  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setComposer(e.target.value);
    const ta = taRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  };

  return (
    <div className="border-t" style={{ borderColor: "var(--line)", background: "var(--bg)" }}>
      <div className="mx-auto max-w-3xl px-4 py-3">
        {/* mode toggles */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = composerMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setComposerMode(m.id)}
                title={m.hint}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all"
                style={{
                  borderColor: active ? "transparent" : "var(--line)",
                  background: active ? themeGradient(t) : "var(--glass)",
                  color: active ? "#fff" : "var(--muted)",
                }}
              >
                <Icon size={12} /> {m.label}
              </button>
            );
          })}
          <span className="mono ml-auto hidden text-[10px] sm:inline" style={{ color: "var(--muted)" }}>
            Enter to send · Shift+Enter for newline
          </span>
        </div>

        {/* input row */}
        <div
          className="flex items-end gap-2 rounded-2xl border p-2 transition-all"
          style={{
            borderColor: focused ? "var(--accent)" : "var(--line)",
            background: "var(--glass)",
            boxShadow: focused ? "0 0 0 3px var(--glow)" : "none",
          }}
        >
          <span
            className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white"
            style={{ background: themeGradient(t) }}
          >
            <Sparkles size={15} />
          </span>
          <textarea
            ref={taRef}
            value={composer}
            onChange={onChange}
            onKeyDown={onKey}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            placeholder={PLACEHOLDERS[composerMode]}
            className="scroll-thin max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none"
            style={{ color: "var(--text)" }}
          />
          {streaming ? (
            <button
              onClick={stopStreaming}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border"
              style={{ borderColor: "var(--line)", background: "var(--glass)", color: "var(--text)" }}
              aria-label="Stop"
              title="Stop generating"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!composer.trim()}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white transition-all disabled:opacity-40"
              style={{ background: themeGradient(t) }}
              aria-label="Send"
              title="Send"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
