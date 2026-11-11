"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MONEYMATE_DEMO_PROMPT } from "@/lib/catalog";
import { budgetProgress } from "@/lib/finance-engine";
import type { AffordabilityResult } from "@/lib/types";
import type { Mandate } from "@/lib/types";
import {
  ACCENT_THEMES,
  DEFAULT_THEME_PREFS,
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  parseThemePrefs,
  type AccentThemeId,
  type Appearance,
} from "@/lib/ui-themes";
import type { PageId, Snapshot } from "@/components/app-types";
import { PAGES } from "@/components/app-types";
import { AppShell, type CommandItem } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/kit";
import { ApprovalList, DemoDisclaimer } from "@/components/screens/Screens";
import {
  AgentsScreen,
  BudgetsScreen,
  CoachScreen,
  DashboardScreen,
  InsightsScreen,
  ReportsScreen,
  SettingsScreen,
  SubscriptionsScreen,
  TransactionsScreen,
  VaultScreen,
} from "@/components/screens/Screens";
import type { ScreenProps } from "@/components/screens/Screens";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}


const PAGE_IDS = new Set<PageId>(PAGES.map((p) => p.id));

function readSearch(): { tab: PageId; appearance: Appearance | null } {
  if (typeof window === "undefined") return { tab: "dashboard", appearance: null };
  const params = new URLSearchParams(window.location.search);
  const rawTab = params.get("tab");
  const tab = rawTab && PAGE_IDS.has(rawTab as PageId) ? (rawTab as PageId) : "dashboard";
  const rawApp = params.get("appearance");
  const appearance = rawApp === "dark" || rawApp === "light" ? rawApp : null;
  return { tab, appearance };
}

function writeSearch(tab: PageId, appearance: Appearance) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  url.searchParams.set("appearance", appearance);
  const next = `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
  const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== cur) window.history.replaceState(null, "", next);
}

export function MoneyMateMesh() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [page, setPageState] = useState<PageId>("dashboard");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState(MONEYMATE_DEMO_PROMPT);
  const [messages, setMessages] = useState<Array<{ role: "user" | "coach"; text: string }>>([]);
  const [analysis, setAnalysis] = useState<AffordabilityResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [appearance, setAppearanceState] = useState<Appearance>(DEFAULT_THEME_PREFS.appearance);
  const [themeId, setThemeIdState] = useState<AccentThemeId>(DEFAULT_THEME_PREFS.themeId);
  const [confirm, setConfirm] = useState<null | { kind: "kill" | "reset" }>(null);

  useEffect(() => {
    const prefs = parseThemePrefs(typeof window !== "undefined" ? localStorage.getItem(THEME_STORAGE_KEY) : null);
    const search = readSearch();
    const appearanceNext = search.appearance ?? prefs.appearance;
    setAppearanceState(appearanceNext);
    setThemeIdState(prefs.themeId);
    applyThemeToDocument({ appearance: appearanceNext, themeId: prefs.themeId });
    setPageState(search.tab);
    writeSearch(search.tab, appearanceNext);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const search = readSearch();
      setPageState(search.tab);
      if (search.appearance) {
        const stored = parseThemePrefs(localStorage.getItem(THEME_STORAGE_KEY));
        const prefs = { appearance: search.appearance, themeId: stored.themeId };
        localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(prefs));
        applyThemeToDocument(prefs);
        setAppearanceState(search.appearance);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const persistTheme = (appearanceNext: Appearance, themeNext: AccentThemeId) => {
    const prefs = { appearance: appearanceNext, themeId: themeNext };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(prefs));
    applyThemeToDocument(prefs);
  };

  const setPage = (p: PageId) => {
    setPageState(p);
    writeSearch(p, appearance);
  };

  const setAppearance = (a: Appearance) => {
    setAppearanceState(a);
    persistTheme(a, themeId);
    writeSearch(page, a);
  };
  const setThemeId = (id: AccentThemeId) => {
    setThemeIdState(id);
    persistTheme(appearance, id);
  };

  const refresh = useCallback(async () => {
    const data = await api<{ finance: Snapshot["finance"] } & Snapshot>("/api/status");
    const extras = await api<{ mandates: Mandate[] }>("/api/mandates");
    setState({ ...data, mandates: extras.mandates });
  }, []);

  useEffect(() => {
    refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<void>, next?: PageId) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh();
      if (next) setPage(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const runScenario = (scenario: string, next: PageId) =>
    run(`Running ${scenario}…`, async () => {
      const res = await api<{ demo?: AffordabilityResult | { scenario?: string } }>("/api/demo/run", {
        method: "POST",
        body: JSON.stringify({ scenario }),
      });
      if (scenario === "laptop" && res.demo && "verdict" in res.demo) {
        setAnalysis(res.demo);
        setChat(MONEYMATE_DEMO_PROMPT);
        setMessages((m) => [
          ...m,
          { role: "user", text: MONEYMATE_DEMO_PROMPT },
          { role: "coach", text: "Affordability numbers were computed by the finance engine. Open the panel on the right for the verdict." },
        ]);
      }
    }, next);

  const askCoach = () =>
    run("Asking the coach…", async () => {
      const res = await api<{ reply: string; analysis: AffordabilityResult | null }>("/api/coach/chat", {
        method: "POST",
        body: JSON.stringify({ message: chat }),
      });
      setMessages((m) => [...m, { role: "user", text: chat }, { role: "coach", text: res.reply }]);
      setAnalysis(res.analysis);
    }, "coach");

  const doReset = () =>
    run("Resetting demo…", async () => {
      await api("/api/demo/reset", { method: "POST" });
      setMessages([]);
      setAnalysis(null);
      setVerifyResult(null);
    }, "dashboard");

  const doKill = () =>
    run("Updating kill switch…", async () => {
      if (!state) return;
      await api("/api/kill-switch", { method: "POST", body: JSON.stringify({ active: !state.settings.kill_switch }) });
    });

  const budgets = useMemo(() => (state ? budgetProgress(state.finance) : []), [state]);
  void budgets;

  if (!state) {
    return (
      <main className="px-6 py-16 text-[var(--mm-muted)]">
        Loading AgentPaL…
        {error && <p className="mt-3 text-rose-600">{error}</p>}
      </main>
    );
  }

  const screenProps: ScreenProps = {
    state,
    run,
    runScenario,
    chat,
    setChat,
    messages,
    analysis,
    askCoach,
    verifyResult,
    setVerifyResult,
    appearance,
    themeId,
    setAppearance,
    setThemeId,
    onOpenCommand: () => setPaletteOpen(true),
    onToggleKillSwitch: () => setConfirm({ kind: "kill" }),
    onResetDemo: () => setConfirm({ kind: "reset" }),
    setPage,
  };

  const commandItems: CommandItem[] = [
    ...PAGES.map((p) => ({
      id: `page-${p.id}`,
      label: `Go to ${p.label}`,
      hint: p.label,
      group: "Pages",
      run: () => setPage(p.id),
    })),
    {
      id: "demo-buy",
      label: "Run demo: Buy safely",
      hint: "Scenario A",
      group: "Demos",
      run: () => runScenario("buy-safely", "vault"),
    },
    {
      id: "demo-subs",
      label: "Run demo: Subscription guardian",
      hint: "Scenario B",
      group: "Demos",
      run: () => runScenario("subscriptions", "subscriptions"),
    },
    {
      id: "demo-mal",
      label: "Run demo: Malicious merchant",
      hint: "Scenario C",
      group: "Demos",
      run: () => runScenario("malicious", "agents"),
    },
    {
      id: "demo-laptop",
      label: "Run demo: Laptop affordability",
      hint: "Scenario D",
      group: "Demos",
      run: () => runScenario("laptop", "coach"),
    },
    {
      id: "reset",
      label: "Reset demo",
      hint: "Reseed store",
      group: "Safety",
      needsConfirm: true,
      confirmTitle: "Reset the demo store?",
      confirmBody: "This reseeds accounts, transactions, mandates and payments to the official demo snapshot. In-session chat is cleared.",
      confirmLabel: "Reset demo",
      danger: true,
      run: () => { void doReset(); },
    },
    {
      id: "kill",
      label: state.settings.kill_switch ? "Release kill switch" : "Engage kill switch",
      hint: "Requires confirm",
      group: "Safety",
      needsConfirm: true,
      confirmTitle: state.settings.kill_switch ? "Release the kill switch?" : "Engage the kill switch?",
      confirmBody: state.settings.kill_switch
        ? "Agent financial activity will be allowed again, still subject to mandates and policy."
        : "This immediately freezes all agent financial activity until you turn it off.",
      confirmLabel: state.settings.kill_switch ? "Release" : "Engage",
      danger: !state.settings.kill_switch,
      run: () => { void doKill(); },
    },
    {
      id: "dark",
      label: appearance === "dark" ? "Switch to light mode" : "Switch to dark mode",
      hint: "Appearance",
      group: "Theme",
      run: () => setAppearance(appearance === "dark" ? "light" : "dark"),
    },
    ...Object.values(ACCENT_THEMES).map((t) => ({
      id: `theme-${t.id}`,
      label: `Theme: ${t.name}`,
      hint: "Accent preset",
      group: "Theme",
      run: () => setThemeId(t.id),
    })),
  ];

  const screen = (() => {
    switch (page) {
      case "transactions":
        return <TransactionsScreen {...screenProps} />;
      case "subscriptions":
        return <SubscriptionsScreen {...screenProps} />;
      case "budgets":
        return <BudgetsScreen {...screenProps} />;
      case "coach":
        return <CoachScreen {...screenProps} />;
      case "vault":
        return <VaultScreen {...screenProps} />;
      case "agents":
        return <AgentsScreen {...screenProps} />;
      case "insights":
        return <InsightsScreen {...screenProps} />;
      case "reports":
        return <ReportsScreen {...screenProps} />;
      case "settings":
        return <SettingsScreen {...screenProps} />;
      default:
        return <DashboardScreen {...screenProps} />;
    }
  })();

  return (
    <>
      <AppShell
        page={page}
        setPage={setPage}
        state={state}
        busy={busy}
        error={error}
        appearance={appearance}
        setAppearance={setAppearance}
        onOpenTheme={() => setPage("settings")}
        commandItems={commandItems}
        paletteOpen={paletteOpen}
        setPaletteOpen={setPaletteOpen}
        approvalsOpen={approvalsOpen}
        setApprovalsOpen={setApprovalsOpen}
        approvalPanel={<ApprovalList pending={state.approvals.filter((a) => a.status === "pending")} run={run} />}
      >
        <div className="mb-4">
          <DemoDisclaimer />
        </div>
        {screen}
      </AppShell>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "reset" ? "Reset the demo store?" : state.settings.kill_switch ? "Release the kill switch?" : "Engage the kill switch?"}
        body={
          confirm?.kind === "reset"
            ? "This reseeds accounts, transactions, mandates and payments to the official demo snapshot."
            : state.settings.kill_switch
              ? "Agent financial activity will be allowed again, still subject to mandates and policy."
              : "This immediately freezes all agent financial activity until you turn it off."
        }
        confirmLabel={confirm?.kind === "reset" ? "Reset demo" : state.settings.kill_switch ? "Release" : "Engage"}
        danger={confirm?.kind === "reset" || !state.settings.kill_switch}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const kind = confirm?.kind;
          setConfirm(null);
          if (kind === "reset") void doReset();
          else void doKill();
        }}
      />
    </>
  );
}
