"use client";

import { useEffect } from "react";
import "./studio.css";
import { useStore } from "@/lib/studio/store";
import Header from "@/components/agentpal/Header";
import Sidebar from "@/components/agentpal/Sidebar";
import ChatPanel from "@/components/agentpal/ChatPanel";
import Composer from "@/components/agentpal/Composer";
import ArtifactCanvas from "@/components/agentpal/ArtifactCanvas";
import MobileNav from "@/components/agentpal/MobileNav";
import Toasts from "@/components/agentpal/Toasts";
import { CommandPalette, ShortcutsModal, SettingsModal } from "@/components/agentpal/Modals";

export default function Page() {
  const {
    theme,
    light,
    zen,
    setPaletteOpen,
    setShortcutsOpen,
    cycleTheme,
    toggleLight,
    loadConversations,
    conversations,
    activeConversationId,
    activeArtifact,
  } = useStore();

  // load conversations on first mount
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        useStore.getState().newConversation();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Escape") {
        const s = useStore.getState();
        if (s.paletteOpen) s.setPaletteOpen(false);
        else if (s.shortcutsOpen) s.setShortcutsOpen(false);
        else if (s.settingsOpen) s.setSettingsOpen(false);
        else if (s.mobileSidebar) s.setMobileSidebar(false);
        else if (s.mobileArtifact) s.setMobileArtifact(false);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "t") {
        e.preventDefault();
        cycleTheme();
      } else if (k === "l") {
        e.preventDefault();
        toggleLight();
      } else if (k === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen, setShortcutsOpen, cycleTheme, toggleLight]);

  // whether to show the artifact canvas column on desktop
  const conv = conversations.find((c) => c.id === activeConversationId);
  const hasArtifact =
    !!conv &&
    conv.messages.some(
      (m) => m.role === "assistant" && m.content.includes("```artifact:")
    );
  const showCanvas = !zen && (hasArtifact || !!activeArtifact);

  return (
    <div
      data-theme={theme}
      data-mode={light ? "light" : "dark"}
      style={{ background: "var(--bg)", color: "var(--text)" }}
      className="agentpal-studio min-h-screen"
    >
      <div className="glowblob" style={{ top: "-12vw", right: "-10vw" }} aria-hidden />
      <div className="glowblob" style={{ bottom: "-14vw", left: "-12vw", opacity: 0.6 }} aria-hidden />
      <div className="grain" aria-hidden />

      <div className="relative z-10 flex min-h-screen flex-col">
        <Header />
        <a className="relative z-10 mx-4 my-2 w-fit rounded-lg border px-3 py-1 text-xs" href="/">← Command Center</a>

        <div className="mx-auto flex w-full max-w-[1600px] flex-1 overflow-hidden">
          {!zen && <Sidebar />}

          {/* center: chat + composer */}
          <main className="flex min-w-0 flex-1 flex-col">
            <ChatPanel />
            <Composer />
          </main>

          {/* right: artifact canvas (desktop) */}
          {showCanvas && (
            <aside
              className="hidden w-[440px] shrink-0 border-l xl:flex xl:flex-col"
              style={{ borderColor: "var(--line)", background: "var(--bg2)" }}
            >
              <ArtifactCanvas />
            </aside>
          )}
        </div>

        {/* Footer (sticky to bottom) */}
        <footer
          className="mt-auto border-t"
          style={{ borderColor: "var(--line)", background: "var(--bg2)" }}
        >
          <div
            className="mx-auto flex max-w-[1600px] flex-col items-center gap-1 px-4 py-4 text-center text-[11px] sm:flex-row sm:justify-between sm:text-left"
            style={{ color: "var(--muted)" }}
          >
            <span className="mono">
              AgentPaL Studio · Coach, artifacts, and PayPal docs · session-only chats
            </span>
            <span className="mono">
              ⌘K command palette · T theme · L light/dark
            </span>
          </div>
        </footer>

        {/* Mobile overlays */}
        <MobileNav />

        {/* Modals */}
        <CommandPalette />
        <ShortcutsModal />
        <SettingsModal />

        {/* Toasts */}
        <Toasts />
      </div>
    </div>
  );
}
