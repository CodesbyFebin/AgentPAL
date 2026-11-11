"use client";

import { DeveloperScreen, InvoicesScreen, RefundsScreen, SecurityScreen } from "@/components/screens/Phase2Screens";
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
  nextAccentTheme,
  parseThemePrefs,
  parseThemeSlug,
  type AccentThemeId,
  type Appearance,
} from "@/lib/ui-themes";
import {
  DEFAULT_SPACE,
  SPACE_STORAGE_KEY,
  SPACES,
  parseSpace,
  spaceToSlug,
  type MoneySpace,
} from "@/lib/spaces";
import { DEFAULT_ZEN_PREFS, ZEN_STORAGE_KEY, parseZenPrefs, shouldZenPause, type ZenPrefs } from "@/lib/zen";
import { approvablePending, skippedBlocked } from "@/lib/approvals-guard";
import type { PageId, Snapshot } from "@/components/app-types";
import { PAGES } from "@/components/app-types";
import { AppShell, type CommandItem } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/kit";
import { ToastHost, type Toast } from "@/components/ui/ToastHost";
import { ZenPauseDialog, type ZenRequest } from "@/components/ui/ZenPauseDialog";
import { ApprovalList, DemoDisclaimer } from "@/components/screens/Screens";
import {
  AgentsScreen,
  BudgetsScreen,
  CoachScreen,
  DashboardScreen,
  InsightsScreen,
  PaymentLinksScreen,
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

function readSearch(): {
  tab: PageId;
  appearance: Appearance | null;
  theme: AccentThemeId | null;
  space: MoneySpace | null;
  zenDemo: boolean;
  approvalsOpen: boolean;
} {
  if (typeof window === "undefined") {
    return { tab: "dashboard", appearance: null, theme: null, space: null, zenDemo: false, approvalsOpen: false };
  }
  const params = new URLSearchParams(window.location.search);
  const rawTab = params.get("tab");
  const tab = rawTab && PAGE_IDS.has(rawTab as PageId) ? (rawTab as PageId) : "dashboard";
  const rawApp = params.get("appearance");
  const appearance = rawApp === "dark" || rawApp === "light" ? rawApp : null;
  const theme = parseThemeSlug(params.get("theme"));
  const space = parseSpace(params.get("space"));
  const zenDemo = params.get("zen") === "demo";
  const approvalsOpen = params.get("approvals") === "open";
  return { tab, appearance, theme, space, zenDemo, approvalsOpen };
}

function writeSearch(opts: {
  tab: PageId;
  appearance: Appearance;
  themeId: AccentThemeId;
  space: MoneySpace;
  zenDemo?: boolean;
  approvalsOpen?: boolean;
}) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", opts.tab);
  url.searchParams.set("appearance", opts.appearance);
  url.searchParams.set("theme", opts.themeId);
  url.searchParams.set("space", spaceToSlug(opts.space));
  if (opts.zenDemo) url.searchParams.set("zen", "demo");
  else url.searchParams.delete("zen");
  if (opts.approvalsOpen) url.searchParams.set("approvals", "open");
  else url.searchParams.delete("approvals");
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
  const [space, setSpaceState] = useState<MoneySpace>(DEFAULT_SPACE);
  const [zenPrefs, setZenPrefsState] = useState<ZenPrefs>(DEFAULT_ZEN_PREFS);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [zenRequest, setZenRequest] = useState<(ZenRequest & { resolve: (ok: boolean) => void }) | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "kill" | "reset" }>(null);

  useEffect(() => {
    const prefs = parseThemePrefs(typeof window !== "undefined" ? localStorage.getItem(THEME_STORAGE_KEY) : null);
    const storedSpace = parseSpace(typeof window !== "undefined" ? localStorage.getItem(SPACE_STORAGE_KEY) : null);
    const storedZen = parseZenPrefs(typeof window !== "undefined" ? localStorage.getItem(ZEN_STORAGE_KEY) : null);
    const search = readSearch();
    const appearanceNext = search.appearance ?? prefs.appearance;
    const themeNext = search.theme ?? prefs.themeId;
    const spaceNext = search.space ?? storedSpace ?? DEFAULT_SPACE;
    setAppearanceState(appearanceNext);
    setThemeIdState(themeNext);
    setSpaceState(spaceNext);
    setZenPrefsState(storedZen);
    applyThemeToDocument({ appearance: appearanceNext, themeId: themeNext });
    setPageState(search.tab);
    if (search.approvalsOpen) setApprovalsOpen(true);
    writeSearch({ tab: search.tab, appearance: appearanceNext, themeId: themeNext, space: spaceNext, zenDemo: search.zenDemo, approvalsOpen: search.approvalsOpen });
    if (search.zenDemo) {
      setZenRequest({
        amount: 65000,
        currency: "INR",
        label: "NovaBook 14 laptop · demo pause",
        demo: true,
        resolve: () => undefined,
      });
    }
  }, []);

  useEffect(() => {
    const onPop = () => {
      const search = readSearch();
      setPageState(search.tab);
      const stored = parseThemePrefs(localStorage.getItem(THEME_STORAGE_KEY));
      const appearanceNext = search.appearance ?? stored.appearance;
      const themeNext = search.theme ?? stored.themeId;
      const prefs = { appearance: appearanceNext, themeId: themeNext };
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(prefs));
      applyThemeToDocument(prefs);
      setAppearanceState(appearanceNext);
      setThemeIdState(themeNext);
      if (search.space) {
        localStorage.setItem(SPACE_STORAGE_KEY, search.space);
        setSpaceState(search.space);
      }
      setApprovalsOpen(search.approvalsOpen);
      if (search.zenDemo) {
        setZenRequest({
          amount: 65000,
          currency: "INR",
          label: "NovaBook 14 laptop · demo pause",
          demo: true,
          resolve: () => undefined,
        });
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

  const syncSearch = (overrides: Partial<{ tab: PageId; appearance: Appearance; themeId: AccentThemeId; space: MoneySpace; zenDemo: boolean; approvalsOpen: boolean }> = {}) => {
    writeSearch({
      tab: overrides.tab ?? page,
      appearance: overrides.appearance ?? appearance,
      themeId: overrides.themeId ?? themeId,
      space: overrides.space ?? space,
      zenDemo: overrides.zenDemo ?? Boolean(zenRequest?.demo),
      approvalsOpen: overrides.approvalsOpen ?? approvalsOpen,
    });
  };

  const setPage = (p: PageId) => {
    setPageState(p);
    syncSearch({ tab: p });
  };

  const setAppearance = (a: Appearance) => {
    setAppearanceState(a);
    persistTheme(a, themeId);
    syncSearch({ appearance: a });
  };
  const setThemeId = (id: AccentThemeId) => {
    setThemeIdState(id);
    persistTheme(appearance, id);
    syncSearch({ themeId: id });
  };
  const setSpace = (s: MoneySpace) => {
    setSpaceState(s);
    localStorage.setItem(SPACE_STORAGE_KEY, s);
    syncSearch({ space: s });
  };
  const setZenPrefs = (prefs: ZenPrefs) => {
    setZenPrefsState(prefs);
    localStorage.setItem(ZEN_STORAGE_KEY, JSON.stringify(prefs));
  };
  const toast = (msg: string, tone: "ok" | "warn" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, msg, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 3200);
  };
  const requestZenPause = (amount: number, currency: string, label?: string) => {
    if (!shouldZenPause(amount, currency, zenPrefs)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setZenRequest({ amount, currency, label, resolve });
    });
  };
  const closeZen = (ok: boolean) => {
    const req = zenRequest;
    setZenRequest(null);
    syncSearch({ zenDemo: false });
    req?.resolve(ok);
    if (req?.demo) toast(ok ? "Zen demo closed" : "Zen demo cancelled", ok ? "ok" : "warn");
    else if (!ok) toast("Payment cancelled during the Zen pause", "warn");
  };
  const openApprovals = (open: boolean) => {
    setApprovalsOpen(open);
    syncSearch({ approvalsOpen: open });
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
      if (scenario === "laptop" && res.demo) {
        const demo = res.demo as { analysis?: AffordabilityResult; verdict?: string } & Partial<AffordabilityResult>;
        const analysis = demo.analysis ?? ("verdict" in demo && demo.verdict ? (demo as AffordabilityResult) : null);
        if (analysis) setAnalysis(analysis);
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

  const approveAll = () => {
    if (!state) return Promise.resolve();
    const opts = { merchants: state.merchants, payments: state.payments };
    const ready = approvablePending(state.approvals, opts);
    const skipped = skippedBlocked(state.approvals.filter((a) => a.status === "pending"), opts);
    if (ready.length === 0) {
      toast(skipped.length ? "Approve all skipped blocked or malicious items. Nothing left to approve." : "Approval queue is already clear", "warn");
      return Promise.resolve();
    }
    return run("Approving ready items…", async () => {
      let ok = 0;
      let failed = 0;
      for (const a of ready) {
        try {
          await api(`/api/approvals/${a.approval_id}/approve`, { method: "POST" });
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      toast(
        `Approved ${ok}${skipped.length ? `, skipped ${skipped.length} blocked` : ""}${failed ? `, ${failed} failed` : ""}.`,
        failed || skipped.length ? "warn" : "ok",
      );
    });
  };

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
    space,
    setSpace,
    toast,
    requestZenPause,
    zenPrefs,
    setZenPrefs,
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
    {
      id: "toggle-theme",
      label: "Toggle Theme",
      hint: ACCENT_THEMES[nextAccentTheme(themeId)].name,
      group: "Theme",
      run: () => {
        const next = nextAccentTheme(themeId);
        setThemeId(next);
        toast(`Theme: ${ACCENT_THEMES[next].name}`);
      },
    },
    ...Object.values(ACCENT_THEMES).map((t) => ({
      id: `theme-${t.id}`,
      label: `Theme: ${t.name}`,
      hint: "Accent preset",
      group: "Theme",
      run: () => setThemeId(t.id),
    })),
    {
      id: "zen-mode",
      label: zenPrefs.enabled ? "Zen Mode (on)" : "Zen Mode (off)",
      hint: "Pause before large payments",
      group: "Theme",
      run: () => {
        const next = { ...zenPrefs, enabled: !zenPrefs.enabled };
        setZenPrefs(next);
        toast(next.enabled ? "Zen Mode on — pause before large payments" : "Zen Mode off");
      },
    },
    {
      id: "ask-coach",
      label: "Ask Coach",
      hint: "Open AI Coach",
      group: "Pages",
      run: () => setPage("coach"),
    },
    {
      id: "approve-pending",
      label: "Approve pending",
      hint: `${approvablePending(state.approvals, { merchants: state.merchants, payments: state.payments }).length} ready`,
      group: "Approvals",
      needsConfirm: true,
      confirmTitle: "Approve all ready items?",
      confirmBody: "Blocked or malicious items are skipped. Each remaining approval is sent to AgentPaL Guard's existing approve endpoint.",
      confirmLabel: "Approve ready items",
      run: () => { void approveAll(); },
    },
    ...SPACES.map((s) => ({
      id: `space-${s}`,
      label: `Switch space: ${s}`,
      hint: s,
      group: "Spaces",
      run: () => {
        setSpace(s);
        toast(s === "My Money" ? "My Money — showing every space" : `${s} space`);
      },
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
      case "links":
        return <PaymentLinksScreen {...screenProps} />;
      case "agents":
        return <AgentsScreen {...screenProps} />;
      case "insights":
        return <InsightsScreen {...screenProps} />;
      case "reports":
        return <ReportsScreen {...screenProps} />;
      case "settings":
        return <SettingsScreen {...screenProps} />;
      case "refunds":
        return <RefundsScreen {...screenProps} />;
      case "invoices":
        return <InvoicesScreen {...screenProps} />;
      case "security":
        return <SecurityScreen {...screenProps} />;
      case "developer":
        return <DeveloperScreen {...screenProps} />;
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
        space={space}
        setSpace={(s) => { setSpace(s); toast(s === "My Money" ? "My Money — showing every space" : `${s} space`); }}
        themeId={themeId}
        onCycleTheme={() => {
          const next = nextAccentTheme(themeId);
          setThemeId(next);
          toast(`Theme: ${ACCENT_THEMES[next].name}`);
        }}
        commandItems={commandItems}
        paletteOpen={paletteOpen}
        setPaletteOpen={setPaletteOpen}
        approvalsOpen={approvalsOpen}
        setApprovalsOpen={openApprovals}
        approvalPanel={
          <ApprovalList
            pending={state.approvals.filter((a) => a.status === "pending")}
            run={run}
            merchants={state.merchants}
            payments={state.payments}
            toast={toast}
            onApproveAll={() => { void approveAll(); }}
          />
        }
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
      <ZenPauseDialog
        open={Boolean(zenRequest)}
        request={zenRequest}
        prefs={zenPrefs}
        onConfirm={() => closeZen(true)}
        onCancel={() => closeZen(false)}
      />
      <ToastHost toasts={toasts} />
    </>
  );
}
