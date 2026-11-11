"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Repeat,
  Wallet,
  Bot,
  Shield,
  Sparkles,
  LineChart,
  FileBarChart,
  Settings,
  Search,
  Bell,
  Sun,
  Moon,
  Command,
  Menu,
  X,
} from "lucide-react";
import { DEMO_USER_NAME } from "@/lib/finance-seed";
import type { PageId, Snapshot } from "@/components/app-types";
import { PAGES } from "@/components/app-types";
import { Badge, Button, ConfirmDialog, LogoMark } from "@/components/ui/kit";
import { paymentModeLabel } from "@/components/screens/Screens";
import type { AccentThemeId, Appearance } from "@/lib/ui-themes";

const ICONS: Record<PageId, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  transactions: ArrowLeftRight,
  subscriptions: Repeat,
  budgets: Wallet,
  coach: Bot,
  vault: Shield,
  agents: Sparkles,
  insights: LineChart,
  reports: FileBarChart,
  settings: Settings,
};

const MOBILE_PRIMARY: PageId[] = ["dashboard", "coach", "agents", "vault"];

export type CommandItem = {
  id: string;
  label: string;
  hint: string;
  group: string;
  needsConfirm?: boolean;
  confirmTitle?: string;
  confirmBody?: string;
  confirmLabel?: string;
  danger?: boolean;
  run: () => void;
};

export function AppShell({
  page,
  setPage,
  state,
  busy,
  error,
  children,
  appearance,
  setAppearance,
  onOpenTheme,
  commandItems,
  paletteOpen,
  setPaletteOpen,
  approvalsOpen,
  setApprovalsOpen,
  approvalPanel,
}: {
  page: PageId;
  setPage: (p: PageId) => void;
  state: Snapshot;
  busy: string | null;
  error: string | null;
  children: ReactNode;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  onOpenTheme: () => void;
  commandItems: CommandItem[];
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  approvalsOpen: boolean;
  setApprovalsOpen: (v: boolean) => void;
  approvalPanel: ReactNode;
}) {
  const [mobileNav, setMobileNav] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const pending = state.approvals.filter((a) => a.status === "pending");
  const pay = paymentModeLabel(state);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  return (
    <div className="min-h-screen md:pl-[260px]">
      <aside className="mm-sidebar fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col text-[var(--mm-sidebar-text)] md:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <LogoMark />
          <div>
            <p className="text-sm font-semibold leading-tight">AgentPaL</p>
            <p className="text-[11px] text-[var(--mm-sidebar-muted)]">Your AI. Your Money. Your Rules.</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {PAGES.map((p) => {
            const Icon = ICONS[p.id];
            const active = page === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPage(p.id)}
                className={`mm-focus flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${
                  active ? "bg-white/15 text-white" : "text-[var(--mm-sidebar-muted)] hover:bg-white/8 hover:text-white"
                }`}
              >
                <Icon size={17} />
                {p.label}
                {p.id === "agents" && pending.length > 0 && (
                  <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[10px] text-white">{pending.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-4 py-4">
          <div
            className="rounded-2xl p-3"
            style={{ background: "linear-gradient(135deg,var(--mm-accent),var(--mm-accent-2))" }}
          >
            <p className="text-xs font-medium text-white/80">AgentPaL Agents</p>
            <p className="text-sm font-semibold">Your AI Finance Crew</p>
            <button type="button" className="mt-2 text-xs text-white/90 underline" onClick={() => setPage("agents")}>
              Manage Agents →
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-xs font-semibold">
              {DEMO_USER_NAME.split(" ").slice(0, 2).map((n) => n[0]).join("")}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{DEMO_USER_NAME}</p>
              <p className="text-[11px] text-[var(--mm-sidebar-muted)]">Demo member</p>
            </div>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-[var(--mm-border)] bg-[color-mix(in_srgb,var(--mm-bg)_82%,transparent)] backdrop-blur-xl">
        <div className="flex items-center gap-3 px-4 py-3 md:px-6">
          <button type="button" className="mm-focus rounded-lg p-2 md:hidden" aria-label="Open menu" onClick={() => setMobileNav(true)}>
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2 md:hidden">
            <LogoMark size={28} />
            <span className="text-sm font-semibold leading-tight">AgentPaL</span>
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command bar"
            className="mm-focus flex items-center gap-2 rounded-full border border-[var(--mm-border)] bg-[var(--mm-surface)] p-2 text-left text-sm text-[var(--mm-muted)] shadow-sm sm:min-w-0 sm:flex-1 sm:px-4 sm:py-2"
          >
            <Search size={16} />
            <span className="hidden truncate sm:inline">Search anything…</span>
            <kbd className="ml-auto hidden rounded border border-[var(--mm-border)] px-1.5 py-0.5 text-[10px] sm:inline">Ctrl + K</kbd>
          </button>
          <span className="hidden sm:inline-flex"><Badge tone={pay.tone}>{pay.label}</Badge></span>
          {state.settings.kill_switch && <Badge tone="danger">Kill switch</Badge>}
          <button type="button" className="mm-focus relative rounded-full p-2" aria-label="Approvals" onClick={() => setApprovalsOpen(true)}>
            <Bell size={18} />
            {pending.length > 0 && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500" />
            )}
          </button>
          <button
            type="button"
            className="mm-focus rounded-full p-2"
            aria-label={appearance === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setAppearance(appearance === "dark" ? "light" : "dark")}
          >
            {appearance === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button type="button" className="mm-focus hidden rounded-full p-2 sm:inline" aria-label="Themes" onClick={onOpenTheme}>
            <Settings size={18} />
          </button>
        </div>
      </header>

      <main className="px-4 py-5 pb-28 md:px-6 md:pb-10">
        {error && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
        {busy && <div className="mb-3 text-sm" style={{ color: "var(--mm-accent)" }}>{busy}</div>}
        {children}
        <footer className="mt-8 flex flex-col gap-2 border-t border-[var(--mm-border)] pt-4 text-[11px] text-[var(--mm-muted)] md:flex-row md:items-center md:justify-between">
          <p className="flex items-center gap-1.5 max-w-3xl"><Shield size={12} /> AgentPaL is an independent hackathon project built on PayPal APIs. It is not a PayPal product and is not endorsed by PayPal. Seeded demo data is protected in this session only.</p>
          <p>Your AI. Your Money. Your Rules.</p>
        </footer>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-[var(--mm-border)] bg-[color-mix(in_srgb,var(--mm-surface)_92%,transparent)] p-1 backdrop-blur-xl md:hidden">
        {MOBILE_PRIMARY.map((id) => {
          const Icon = ICONS[id];
          const meta = PAGES.find((p) => p.id === id)!;
          return (
            <button key={id} type="button" className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${page === id ? "text-[var(--mm-accent)]" : "text-[var(--mm-muted)]"}`} onClick={() => setPage(id)}>
              <Icon size={18} />
              {meta.label.replace("PayPal ", "")}
            </button>
          );
        })}
        <button type="button" className="flex flex-col items-center gap-0.5 py-2 text-[10px] text-[var(--mm-muted)]" onClick={() => setMoreOpen(true)}>
          <Menu size={18} />
          More
        </button>
      </nav>

      {mobileNav && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileNav(false)}>
          <div className="mm-sidebar h-full w-[260px] p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between px-2 text-[var(--mm-sidebar-text)]">
              <span className="flex items-center gap-2 font-semibold"><LogoMark size={24} /> AgentPaL</span>
              <button type="button" aria-label="Close menu" onClick={() => setMobileNav(false)}><X size={18} /></button>
            </div>
            {PAGES.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[var(--mm-sidebar-text)]"
                onClick={() => { setPage(p.id); setMobileNav(false); }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 p-4 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="mm-card mm-slide-up ml-auto mt-auto w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-sm font-semibold">More</p>
            {PAGES.filter((p) => !MOBILE_PRIMARY.includes(p.id)).map((p) => (
              <button key={p.id} type="button" className="block w-full rounded-xl px-3 py-2 text-left text-sm" onClick={() => { setPage(p.id); setMoreOpen(false); }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {approvalsOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={() => setApprovalsOpen(false)}>
          <div className="mm-card m-0 h-full w-full max-w-md overflow-y-auto rounded-none p-5 md:m-4 md:h-auto md:max-h-[90vh] md:rounded-[24px]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Approvals</h2>
              <button type="button" aria-label="Close approvals" onClick={() => setApprovalsOpen(false)}><X size={18} /></button>
            </div>
            {pending.length === 0 && <p className="text-sm text-[var(--mm-muted)]">No pending approvals.</p>}
            {approvalPanel}
          </div>
        </div>
      )}

      <CommandBar open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commandItems} />
    </div>
  );
}

function CommandBar({ open, onClose, items }: { open: boolean; onClose: () => void; items: CommandItem[] }) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pending, setPending] = useState<CommandItem | null>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => `${i.label} ${i.hint} ${i.group}`.toLowerCase().includes(s));
  }, [items, q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      setPending(null);
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [q]);

  if (!open) return null;

  const activate = (item: CommandItem) => {
    if (item.needsConfirm) {
      setPending(item);
      return;
    }
    item.run();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 p-3 backdrop-blur-sm sm:p-6" onClick={onClose} role="presentation">
      <div
        className="mm-slide-up mx-auto max-w-[640px] overflow-hidden rounded-[24px] border border-[var(--mm-border)] bg-[var(--mm-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command bar"
      >
        {pending ? (
          <div className="p-6">
            <h2 className="text-lg font-semibold">{pending.confirmTitle || "Confirm"}</h2>
            <p className="mt-2 text-sm text-[var(--mm-muted)]">{pending.confirmBody}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPending(null)}>Back</Button>
              <Button
                variant={pending.danger ? "danger" : "primary"}
                onClick={() => {
                  pending.run();
                  onClose();
                }}
              >
                {pending.confirmLabel || "Confirm"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-[var(--mm-border)] px-4 py-4">
              <Command size={19} />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(results.length - 1, c + 1));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(0, c - 1));
                  }
                  if (e.key === "Enter" && results[cursor]) activate(results[cursor]);
                }}
                placeholder="Jump to a page, run a demo, toggle theme…"
                className="min-w-0 flex-1 bg-transparent text-lg outline-none"
              />
              <kbd className="rounded border border-[var(--mm-border)] px-1.5 text-xs">ESC</kbd>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {results.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => activate(r)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm ${i === cursor ? "bg-[color-mix(in_srgb,var(--mm-accent)_12%,transparent)]" : "hover:bg-[var(--mm-subtle)]"}`}
                >
                  <span>
                    <span className="font-medium">{r.label}</span>
                    <span className="mt-0.5 block text-[11px] text-[var(--mm-muted)]">{r.group}</span>
                  </span>
                  <span className="text-xs text-[var(--mm-muted)]">{r.hint}</span>
                </button>
              ))}
              {results.length === 0 && <div className="p-4 text-sm text-[var(--mm-muted)]">No matches.</div>}
            </div>
            <div className="flex gap-3 border-t border-[var(--mm-border)] px-4 py-2.5 text-[11px] text-[var(--mm-muted)]">
              <span>↑↓ navigate</span>
              <span>↵ run</span>
              <span>esc close</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
