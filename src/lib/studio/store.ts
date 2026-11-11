"use client";

import { create } from "zustand";
import { THEMES, type ThemeName } from "@/lib/studio/themes";

/* ----------------------------- Types ----------------------------- */

export interface Toast {
  id: number;
  msg: string;
}

export type ComposerMode = "chat" | "imagine" | "search";

export interface Msg {
  id: string; // local id (matches server id once persisted)
  role: "user" | "assistant";
  content: string; // markdown text OR data:image url (type=image)
  type: "text" | "image";
  createdAt: number;
  streaming?: boolean;
  sources?: Source[];
}

export interface Source {
  url: string;
  name: string;
  snippet?: string;
}

export interface Conv {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: number;
  messages: Msg[];
  loaded?: boolean;
}

interface Settings {
  streaming: boolean;
  sound: boolean;
  zen: boolean;
}

/* ----------------------------- Store ----------------------------- */

let toastId = 1;

export interface ArtifactView {
  conversationId: string;
  messageId: string;
}

interface AgentPalState {
  // theme + appearance
  theme: ThemeName;
  light: boolean;
  zen: boolean;

  // navigation / overlays
  mobileSidebar: boolean;
  mobileArtifact: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  settingsOpen: boolean;
  paletteQuery: string;

  // conversations
  conversations: Conv[];
  activeConversationId: string | null;
  loadedConversations: boolean;

  // streaming state
  streaming: boolean;

  // composer
  composer: string;
  composerMode: ComposerMode;

  // active artifact in canvas
  activeArtifact: ArtifactView | null;

  // search (palette / sidebar filter)
  search: string;

  // settings + toasts
  settings: Settings;
  toasts: Toast[];

  // ---- actions ----
  setTheme: (t: ThemeName) => void;
  cycleTheme: () => void;
  toggleLight: () => void;
  toggleZen: () => void;
  setMobileSidebar: (v: boolean) => void;
  setMobileArtifact: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setPaletteQuery: (s: string) => void;
  setSearch: (s: string) => void;
  setComposer: (s: string) => void;
  setComposerMode: (m: ComposerMode) => void;
  toggleSetting: (k: keyof Settings) => void;

  // conversation actions
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => void; // local: clears active → welcome screen
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;

  // messaging
  sendMessage: (text: string) => Promise<void>;
  sendImagine: (prompt: string) => Promise<void>;
  regenerateLast: () => Promise<void>;
  stopStreaming: () => void;

  // artifacts
  openArtifact: (conversationId: string, messageId: string) => void;
  closeArtifact: () => void;

  // toasts
  pushToast: (msg: string) => void;
  dismissToast: (id: number) => void;

  // misc
  runCommand: (c: string) => void;
}

// hold the current AbortController for the in-flight stream
let streamController: AbortController | null = null;

export const useStore = create<AgentPalState>((set, get) => ({
  theme: "Aurora",
  light: false,
  zen: false,

  mobileSidebar: false,
  mobileArtifact: false,
  paletteOpen: false,
  shortcutsOpen: false,
  settingsOpen: false,
  paletteQuery: "",

  conversations: [],
  activeConversationId: null,
  loadedConversations: false,

  streaming: false,

  composer: "",
  composerMode: "chat",

  activeArtifact: null,

  search: "",

  settings: {
    streaming: true,
    sound: false,
    zen: false,
  },

  toasts: [],

  setTheme: (t) => set({ theme: t }),
  cycleTheme: () => {
    const cur = get().theme;
    const idx = THEMES.findIndex((t) => t.name === cur);
    const next = THEMES[(idx + 1) % THEMES.length].name;
    set({ theme: next });
    get().pushToast(`Theme · ${next}`);
  },
  toggleLight: () => {
    set((s) => ({ light: !s.light }));
    get().pushToast(get().light ? "Light mode" : "Dark mode");
  },
  toggleZen: () =>
    set((s) => {
      const zen = !s.zen;
      return { zen, settings: { ...s.settings, zen } };
    }),

  setMobileSidebar: (v) => set({ mobileSidebar: v }),
  setMobileArtifact: (v) => set({ mobileArtifact: v }),
  setPaletteOpen: (v) => set({ paletteOpen: v, paletteQuery: "" }),
  setShortcutsOpen: (v) => set({ shortcutsOpen: v }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setPaletteQuery: (s) => set({ paletteQuery: s }),
  setSearch: (s) => set({ search: s }),
  setComposer: (s) => set({ composer: s }),
  setComposerMode: (m) => set({ composerMode: m }),

  toggleSetting: (k) =>
    set((s) => {
      const next = { ...s.settings, [k]: !s.settings[k] };
      if (k === "zen") return { settings: next, zen: next.zen };
      return { settings: next };
    }),

  /* ----------------------- Conversations ----------------------- */

  loadConversations: async () => {
    set({ loadedConversations: true });
  },
  selectConversation: async (id) => {
    set({ activeConversationId: id, activeArtifact: null, mobileSidebar: false });
  },
  newConversation: () => {
    streamController?.abort();
    set({ activeConversationId: null, activeArtifact: null, composer: "", mobileSidebar: false });
  },
  renameConversation: async (id, title) => {
    const name = title.trim().slice(0, 80);
    if (!name) return;
    set((s) => ({ conversations: s.conversations.map((c) => c.id === id ? { ...c, title: name } : c) }));
  },
  deleteConversation: async (id) => {
    if (get().activeConversationId === id) get().newConversation();
    set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) }));
  },
  togglePin: async (id) => {
    set((s) => ({ conversations: s.conversations.map((c) => c.id === id ? { ...c, pinned: !c.pinned } : c) }));
  },

  sendMessage: async (text) => {
    const content = text.trim();
    if (!content || get().streaming) return;
    const existingId = get().activeConversationId;
    const id = existingId || crypto.randomUUID();
    const now = Date.now();
    const user: Msg = { id: crypto.randomUUID(), role: "user", content, type: "text", createdAt: now };
    const controller = new AbortController();
    streamController = controller;
    set((s) => ({
      composer: "",
      streaming: true,
      activeConversationId: id,
      conversations: existingId
        ? s.conversations.map((c) => c.id === id ? { ...c, messages: [...c.messages, user], updatedAt: now } : c)
        : [{ id, title: content.slice(0, 50), pinned: false, updatedAt: now, messages: [user], loaded: true }, ...s.conversations],
    }));
    let reply: string;
    let sources: Source[] | undefined;
    try {
      const mode = get().composerMode;
      const res = await fetch("/api/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, mode }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      reply = data.reply;
      sources = data.sources;
    } catch (error) {
      reply = controller.signal.aborted
        ? "Stopped waiting. Check the Command Center for any action already processed."
        : error instanceof Error ? error.message : "The Studio request failed.";
    }
    const assistant: Msg = { id: crypto.randomUUID(), role: "assistant", content: reply, type: "text", createdAt: Date.now(), sources };
    set((s) => ({
      streaming: false,
      conversations: s.conversations.map((c) => c.id === id ? { ...c, messages: [...c.messages, assistant] } : c),
    }));
    streamController = null;
  },
  sendImagine: async (text) => get().sendMessage(text),
  regenerateLast: async () => {
    const conv = get().conversations.find((c) => c.id === get().activeConversationId);
    const last = conv?.messages.slice().reverse().find((m) => m.role === "user");
    if (last) get().setComposer(last.content);
  },
  stopStreaming: () => streamController?.abort(),

  /* ----------------------- Artifacts ----------------------- */

  openArtifact: (conversationId, messageId) => {
    set({ activeArtifact: { conversationId, messageId }, mobileArtifact: true });
  },
  closeArtifact: () => set({ activeArtifact: null, mobileArtifact: false }),

  /* ----------------------- Toasts ----------------------- */

  pushToast: (msg) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, msg }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3200);
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  /* ----------------------- Commands ----------------------- */

  runCommand: (c) => {
    const s = get();
    switch (c) {
      case "New chat":
        s.newConversation();
        s.setPaletteOpen(false);
        s.pushToast("New chat");
        break;
      case "Toggle Theme":
        s.cycleTheme();
        s.setPaletteOpen(false);
        break;
      case "Light / Dark":
        s.toggleLight();
        s.setPaletteOpen(false);
        break;
      case "Zen Mode":
        s.toggleZen();
        s.setPaletteOpen(false);
        s.pushToast(s.zen ? "Zen mode on" : "Zen mode off");
        break;
      case "Artifacts mode":
        s.setComposerMode("imagine");
        s.setPaletteOpen(false);
        s.pushToast("Artifacts mode");
        break;
      case "Docs search mode":
        s.setComposerMode("search");
        s.setPaletteOpen(false);
        s.pushToast("PayPal documentation search");
        break;
      case "Chat mode":
        s.setComposerMode("chat");
        s.setPaletteOpen(false);
        break;
      case "Open Shortcuts":
        s.setShortcutsOpen(true);
        s.setPaletteOpen(false);
        break;
    }
  },
}));

export const SUGGESTIONS = [
  "Show my demo accounts and budgets",
  "Can I afford a ₹65,000 laptop?",
  "Explain my savings goals",
  "Find documentation for PayPal webhooks",
  "List my PayPal invoices",
  "Make an HTML spending tracker",
];

export const COMMANDS = [
  "New chat",
  "Artifacts mode",
  "Docs search mode",
  "Chat mode",
  "Toggle Theme",
  "Light / Dark",
  "Zen Mode",
  "Open Shortcuts",
] as const;

export const SHORTCUTS: { action: string; keys: string }[] = [
  { action: "Command palette", keys: "⌘K / Ctrl+K" },
  { action: "Send message", keys: "Enter" },
  { action: "Newline in composer", keys: "Shift+Enter" },
  { action: "Close dialogs", keys: "Esc" },
  { action: "Cycle theme", keys: "T" },
  { action: "Toggle light / dark", keys: "L" },
];
