"use client";

import { Plus, X, MessageSquare, Pin, Trash2 } from "lucide-react";
import { useStore } from "@/lib/studio/store";
import { themeGradient } from "@/lib/studio/themes";
import { THEMES } from "@/lib/studio/themes";
import ArtifactCanvas from "./ArtifactCanvas";

function MobileSidebarDrawer() {
  const {
    mobileSidebar,
    setMobileSidebar,
    conversations,
    activeConversationId,
    selectConversation,
    newConversation,
    deleteConversation,
    togglePin,
    theme,
  } = useStore();
  const t = THEMES.find((x) => x.name === theme)!;
  if (!mobileSidebar) return null;
  const pinned = conversations.filter((c) => c.pinned);
  const rest = conversations.filter((c) => !c.pinned);

  return (
    <div className="fixed inset-0 z-[90] lg:hidden">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,.5)" }}
        onClick={() => setMobileSidebar(false)}
      />
      <div
        className="absolute inset-y-0 left-0 flex w-[280px] flex-col border-r"
        style={{ background: "var(--bg2)", borderColor: "var(--line)" }}
      >
        <div className="flex items-center gap-2 border-b p-3" style={{ borderColor: "var(--line)" }}>
          <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
            Chats
          </span>
          <button onClick={() => setMobileSidebar(false)} className="ml-auto" style={{ color: "var(--muted)" }} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-3">
          <button
            onClick={() => {
              newConversation();
              setMobileSidebar(false);
            }}
            className="grad-btn flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold"
            style={{ background: themeGradient(t) }}
          >
            <Plus size={16} /> New chat
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
          {[["Pinned", pinned], ["Recent", rest]].map(([label, list]) => {
            const arr = list as typeof conversations;
            if (!arr.length) return null;
            return (
              <div key={label as string}>
                <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                  {label as string}
                </div>
                {arr.map((c) => (
                  <div
                    key={c.id}
                    className="group flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm"
                    style={{
                      background: activeConversationId === c.id ? "var(--glass)" : "transparent",
                      border: "1px solid " + (activeConversationId === c.id ? "var(--line)" : "transparent"),
                      color: "var(--text)",
                    }}
                  >
                    <MessageSquare size={14} style={{ color: "var(--muted)" }} />
                    <button onClick={() => selectConversation(c.id)} className="flex-1 truncate text-left">
                      {c.title}
                    </button>
                    <button onClick={() => togglePin(c.id)} style={{ color: c.pinned ? "var(--accent)" : "var(--muted)" }} className="p-1">
                      <Pin size={13} />
                    </button>
                    <button onClick={() => deleteConversation(c.id)} style={{ color: "var(--muted)" }} className="p-1">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MobileArtifactDrawer() {
  const { mobileArtifact, setMobileArtifact } = useStore();
  if (!mobileArtifact) return null;
  return (
    <div className="fixed inset-0 z-[90] xl:hidden">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,.5)" }}
        onClick={() => setMobileArtifact(false)}
      />
      <div
        className="absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col border-l"
        style={{ background: "var(--bg)", borderColor: "var(--line)" }}
      >
        <ArtifactCanvas />
      </div>
    </div>
  );
}

export default function MobileNav() {
  const { setMobileArtifact, activeArtifact, conversations, activeConversationId } = useStore();

  // show a floating "view artifact" button on mobile when an artifact exists
  const conv = conversations.find((c) => c.id === activeConversationId);
  const hasArtifact = conv?.messages.some((m) => m.role === "assistant" && m.content.includes("```artifact:"));
  const showFab = hasArtifact && !activeArtifact;

  return (
    <>
      <MobileSidebarDrawer />
      <MobileArtifactDrawer />
      {showFab && (
        <button
          onClick={() => setMobileArtifact(true)}
          className="fixed bottom-24 right-4 z-40 flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-lg xl:hidden"
          style={{ background: "linear-gradient(120deg, var(--accent), var(--accent2))" }}
        >
          View artifact
        </button>
      )}
    </>
  );
}
