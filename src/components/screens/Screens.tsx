"use client";

import { useMemo, useState } from "react";
import {
  Wallet,
  ShoppingCart,
  CalendarClock,
  Target,
  Send,
  Users,
  FileText,
  PiggyBank,
  Check,
} from "lucide-react";
import { DEMO_AS_OF, DEMO_MONTH, DEMO_USER_NAME } from "@/lib/finance-seed";
import { budgetProgress, monthlyCashFlow } from "@/lib/finance-engine";
import { formatINR, formatMoney, DEMO_FX } from "@/lib/money";
import { annualizedDelta, lifecycleOf, raisedThisYear } from "@/lib/subscription-metrics";
import { MONEYMATE_DEMO_PROMPT } from "@/lib/catalog";
import { BraintreeCheckout } from "@/components/BraintreeCheckout";
import { ACCENT_THEMES, type AccentThemeId, type Appearance } from "@/lib/ui-themes";
import type { AffordabilityResult, Approval, AiCallLog, LedgerTxn } from "@/lib/types";
import type { PageId, RunFn, Snapshot } from "@/components/app-types";
import {
  Badge,
  Button,
  Card,
  Donut,
  EmptyState,
  LineChart,
  MetricCard,
  ProgressBar,
  RobotMascot,
} from "@/components/ui/kit";

export type ScreenProps = {
  state: Snapshot;
  run: RunFn;
  runScenario: (scenario: string, next: PageId) => void;
  chat: string;
  setChat: (v: string) => void;
  messages: Array<{ role: "user" | "coach"; text: string }>;
  analysis: AffordabilityResult | null;
  askCoach: () => void;
  verifyResult: string | null;
  setVerifyResult: (v: string | null) => void;
  appearance: Appearance;
  themeId: AccentThemeId;
  setAppearance: (a: Appearance) => void;
  setThemeId: (id: AccentThemeId) => void;
  onOpenCommand: () => void;
  onToggleKillSwitch: () => void;
  onResetDemo: () => void;
  setPage: (p: PageId) => void;
};

function asOfLabel() {
  return "Demo snapshot as of 10 Nov 2026, noon IST · seeded data, not a live account";
}

function paymentModeLabel(state: Snapshot) {
  const paymentMode = state.modes.payment || (state.modes.paypal === "mock" ? "mock" : "paypal-sandbox");
  if (paymentMode === "mock") return { label: "Mock payments", tone: "warning" as const, mode: paymentMode };
  if (paymentMode.startsWith("braintree")) return { label: "Braintree sandbox", tone: "success" as const, mode: paymentMode };
  return { label: "PayPal sandbox", tone: "success" as const, mode: paymentMode };
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function weeklySeries(txns: LedgerTxn[]) {
  const weeks: { start: string; income: number; spend: number }[] = [];
  const sorted = [...txns].sort((a, b) => a.posted_at.localeCompare(b.posted_at));
  if (!sorted.length) return { labels: [] as string[], income: [] as number[], spend: [] as number[] };
  const start = new Date(sorted[0].posted_at);
  const end = new Date(sorted[sorted.length - 1].posted_at);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    weeks.push({ start: key, income: 0, spend: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  for (const t of sorted) {
    const idx = Math.max(
      0,
      Math.min(weeks.length - 1, Math.floor((new Date(t.posted_at).getTime() - new Date(weeks[0].start).getTime()) / (7 * 86400000))),
    );
    if (t.amount > 0 && t.category !== "Transfers") weeks[idx].income += t.amount;
    if (t.amount < 0 && t.category !== "Transfers") weeks[idx].spend += Math.abs(t.amount);
  }
  const last = weeks.slice(-8);
  return {
    labels: last.map((w) => w.start.slice(5)),
    income: last.map((w) => Math.round(w.income)),
    spend: last.map((w) => Math.round(w.spend)),
  };
}

function topMerchants(txns: LedgerTxn[], month: string, limit = 5) {
  const map = new Map<string, number>();
  for (const t of txns) {
    if (monthKey(t.posted_at) !== month) continue;
    if (t.amount >= 0 || t.category === "Transfers") continue;
    map.set(t.merchant, (map.get(t.merchant) || 0) + Math.abs(t.amount));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function DemoDisclaimer() {
  return (
    <p className="rounded-2xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark-note">
      All balances, transactions, budgets, bills and subscriptions shown here are seeded demo data, not a live bank or
      personal PayPal history. MoneyMate Mesh is a hackathon project built on PayPal APIs and is not a PayPal product or
      endorsement. {asOfLabel()}.
    </p>
  );
}

export function DashboardScreen({
  state,
  setPage,
  runScenario,
  analysis,
}: ScreenProps) {
  const flow = monthlyCashFlow(state.finance);
  const budgets = budgetProgress(state.finance);
  const totalBalance = state.finance.accounts.reduce((s, a) => s + a.balance, 0);
  const upcoming = state.finance.bills.reduce((s, b) => s + b.amount, 0);
  const nextBill = [...state.finance.bills].sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
  const goal = state.finance.savings_goals[0];
  const goalPct = goal ? Math.round((goal.current_amount / goal.target_amount) * 100) : 0;
  const spent = budgets.reduce((s, b) => s + b.spent, 0);
  const limit = budgets.reduce((s, b) => s + b.monthly_limit, 0);
  const onTrack = limit ? Math.round(((limit - spent) / limit) * 100) : 0;
  const chart = weeklySeries(state.finance.transactions);
  const recent = [...state.finance.transactions].sort((a, b) => b.posted_at.localeCompare(a.posted_at)).slice(0, 5);
  const pending = state.approvals.filter((a) => a.status === "pending");
  const seedSubs = state.finance.transactions.filter((t) => t.category === "Entertainment" && t.amount < 0);
  const uniqueEnt = new Map<string, LedgerTxn>();
  for (const t of seedSubs) uniqueEnt.set(t.merchant, t);

  return (
    <div className="space-y-5">
      <div
        className="relative overflow-hidden rounded-[24px] px-6 py-6 text-white shadow-glow md:px-8"
        style={{ background: "linear-gradient(120deg,var(--mm-accent),color-mix(in srgb,var(--mm-accent-2) 85%,#1d4ed8))" }}
      >
        <div className="flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <RobotMascot className="h-24 w-24 shrink-0 md:h-28 md:w-28" />
            <div>
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Smarter Money. Powered by AI.</h2>
              <p className="mt-1 max-w-xl text-sm text-white/80">Your personal finance copilot, with PayPal at the core of sandbox checkout — not as an endorsement.</p>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/85">
                <li className="flex items-center gap-1"><Check size={14} /> Auto-track app subscriptions</li>
                <li className="flex items-center gap-1"><Check size={14} /> Smart spending insights</li>
                <li className="flex items-center gap-1"><Check size={14} /> AI-powered proposals</li>
                <li className="flex items-center gap-1"><Check size={14} /> Sandbox PayPal payments</li>
              </ul>
            </div>
          </div>
          <Button variant="secondary" className="bg-white text-slate-900" onClick={() => setPage("coach")}>
            Explore features →
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Balance" value={formatINR(totalBalance)} hint={asOfLabel()} trend="+ seeded accounts" trendUp icon={<Wallet size={16} />} />
        <MetricCard label="This Month Spending" value={formatINR(flow.expenses)} hint={`${flow.month} · transfers excluded`} trendUp={false} icon={<ShoppingCart size={16} />} />
        <MetricCard
          label="Upcoming Payments"
          value={formatINR(upcoming)}
          hint={nextBill ? `Next: ${nextBill.name} due ${nextBill.due_at.slice(0, 10)}` : "No bills"}
          icon={<CalendarClock size={16} />}
        />
        <MetricCard
          label="Savings Goal"
          value={goal ? `${formatINR(goal.current_amount)} / ${formatINR(goal.target_amount)}` : "—"}
          hint={goal ? `${goal.name} · ${goalPct}%` : "No goals"}
          icon={<Target size={16} />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Spending Overview</h3>
            <span className="text-xs text-[var(--mm-muted)]">Weekly · last 8 weeks of seed ledger</span>
          </div>
          <LineChart
            series={[
              { name: "Spending", color: "var(--mm-accent)", points: chart.spend },
              { name: "Income", color: "var(--mm-accent-2)", points: chart.income },
            ]}
          />
          <div className="mt-1 flex gap-4 text-xs text-[var(--mm-muted)]">
            <span>Income {formatINR(flow.income)}</span>
            <span>Expenses {formatINR(flow.expenses)}</span>
            <span>Net {formatINR(flow.net)}</span>
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Recent Transactions</h3>
            <button className="text-xs font-medium text-[var(--mm-accent)]" onClick={() => setPage("transactions")}>
              View all →
            </button>
          </div>
          <ul className="mt-3 space-y-2.5">
            {recent.map((t) => (
              <li key={t.txn_id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.merchant}</p>
                  <p className="text-xs text-[var(--mm-muted)]">{t.category} · {dayKey(t.posted_at)}</p>
                </div>
                <span className={`tabular font-medium ${t.amount < 0 ? "text-[var(--mm-ink)]" : "text-[var(--mm-success)]"}`}>
                  {t.amount > 0 ? "+" : ""}
                  {formatINR(t.amount)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Subscriptions Intelligence</h3>
            <button className="text-xs font-medium text-[var(--mm-accent)]" onClick={() => setPage("subscriptions")}>
              View all →
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--mm-muted)]">
            Only subscriptions created through this app are managed. Seed ledger merchants such as Netflix are shown as
            historical spend, not as cancellable PayPal billing agreements.
          </p>
          {state.subscriptions.length === 0 ? (
            <div className="mt-3 space-y-2">
              {[...uniqueEnt.values()].slice(0, 3).map((t) => (
                <div key={t.txn_id} className="flex items-center justify-between rounded-xl border border-[var(--mm-border)] px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{t.merchant}</p>
                    <p className="text-xs text-[var(--mm-muted)]">Seed ledger · not managed</p>
                  </div>
                  <span className="tabular text-xs">{formatINR(Math.abs(t.amount))}</span>
                </div>
              ))}
              <Button variant="secondary" onClick={() => runScenario("subscriptions", "subscriptions")}>
                Run subscription guardian demo
              </Button>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {state.subscriptions.slice(0, 4).map((s) => (
                <li key={s.subscription_id} className="flex items-center justify-between text-sm">
                  <span>{s.plan_name}</span>
                  <span className="tabular">{formatMoney(s.amount, s.currency)} / mo</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col items-center sm:flex-row sm:items-center sm:gap-4">
          <Donut percent={Math.max(0, onTrack)} label="On Track" sub="budget remaining" />
          <div className="mt-3 w-full sm:mt-0">
            <h3 className="font-semibold">Budget Overview</h3>
            <ul className="mt-2 space-y-2">
              {budgets.slice(0, 5).map((b) => (
                <li key={b.budget_id}>
                  <div className="mb-1 flex justify-between text-xs text-[var(--mm-muted)]">
                    <span>{b.category}</span>
                    <span className="tabular">
                      {formatINR(b.spent)} / {formatINR(b.monthly_limit)}
                    </span>
                  </div>
                  <ProgressBar value={b.spent} max={b.monthly_limit} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-[var(--mm-success)]">
              {onTrack}% of this month&apos;s budget envelope is still available (seed data).
            </p>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold">Quick Actions</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              { icon: <Send size={16} />, label: "Sandbox checkout", go: () => setPage("vault"), sub: "PayPal / Braintree" },
              { icon: <Users size={16} />, label: "Split bill", go: undefined, sub: "Not in this demo" },
              { icon: <FileText size={16} />, label: "Create invoice", go: undefined, sub: "Not in this demo" },
              { icon: <PiggyBank size={16} />, label: "Set budget", go: () => setPage("budgets"), sub: "View envelopes" },
            ].map((a) => (
              <button
                key={a.label}
                type="button"
                disabled={!a.go}
                onClick={a.go}
                className="mm-focus rounded-2xl border border-[var(--mm-border)] px-3 py-3 text-left text-sm disabled:opacity-60"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl text-white" style={{ background: "linear-gradient(135deg,var(--mm-accent),var(--mm-accent-2))" }}>
                  {a.icon}
                </span>
                <p className="mt-2 font-medium">{a.label}</p>
                <p className="text-[11px] text-[var(--mm-muted)]">{a.sub}</p>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => runScenario("buy-safely", "vault")}>Buy safely</Button>
            <Button variant="secondary" onClick={() => setPage("coach")}>Laptop coach</Button>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h3 className="font-semibold">MeshPaL AI Assistant</h3>
          <p className="mt-1 text-sm text-[var(--mm-muted)]">
            Hi {DEMO_USER_NAME.split(" ")[0]} — here is a snapshot computed by the finance engine, not by the model.
          </p>
          {pending.length > 0 && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {pending.length} approval{pending.length > 1 ? "s" : ""} waiting. Open the bell or Agents to review.
            </div>
          )}
          {analysis && (
            <p className="mt-3 text-sm">
              Laptop verdict: <Badge tone={analysis.verdict === "NOT_RECOMMENDED" ? "danger" : analysis.verdict === "AFFORDABLE" ? "success" : "warning"}>{analysis.verdict.replaceAll("_", " ")}</Badge>
            </p>
          )}
          <Button className="mt-4" variant="secondary" onClick={() => setPage("coach")}>
            Ask the AI Coach
          </Button>
        </Card>
        <Card>
          <h3 className="font-semibold">Hackathon demos</h3>
          <p className="mt-1 text-xs text-[var(--mm-muted)]">Each run resets relevant demo state and walks a judged scenario.</p>
          <div className="mt-3 flex flex-col gap-2">
            <Button onClick={() => runScenario("buy-safely", "vault")}>A · Buy safely ($50)</Button>
            <Button variant="secondary" onClick={() => runScenario("subscriptions", "subscriptions")}>B · Subscription guardian</Button>
            <Button variant="secondary" onClick={() => runScenario("malicious", "agents")}>C · Malicious merchant</Button>
            <Button variant="secondary" onClick={() => runScenario("laptop", "coach")}>D · Laptop affordability</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function TransactionsScreen({ state }: ScreenProps) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [range, setRange] = useState("all");
  const cats = ["all", ...Array.from(new Set(state.finance.transactions.map((t) => t.category)))];
  const rows = useMemo(() => {
    return [...state.finance.transactions]
      .sort((a, b) => b.posted_at.localeCompare(a.posted_at))
      .filter((t) => {
        if (cat !== "all" && t.category !== cat) return false;
        if (range === "month" && monthKey(t.posted_at) !== DEMO_MONTH) return false;
        if (range === "90d") {
          const cutoff = new Date("2026-08-12T00:00:00.000Z");
          if (new Date(t.posted_at) < cutoff) return false;
        }
        if (q) {
          const hay = `${t.merchant} ${t.category} ${t.note || ""} ${t.txn_id}`.toLowerCase();
          if (!hay.includes(q.toLowerCase())) return false;
        }
        return true;
      });
  }, [state.finance.transactions, q, cat, range]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Transactions</h2>
          <p className="text-sm text-[var(--mm-muted)]">Evidence browser for the seed ledger and MeshPaL payments. Every row is labelled demo data.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search merchants…"
            className="mm-focus rounded-full border border-[var(--mm-border)] bg-[var(--mm-surface)] px-4 py-2 text-sm"
          />
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="mm-focus rounded-full border border-[var(--mm-border)] bg-[var(--mm-surface)] px-3 py-2 text-sm">
            {cats.map((c) => (
              <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>
            ))}
          </select>
          <select value={range} onChange={(e) => setRange(e.target.value)} className="mm-focus rounded-full border border-[var(--mm-border)] bg-[var(--mm-surface)] px-3 py-2 text-sm">
            <option value="all">All seeded history</option>
            <option value="month">This demo month</option>
            <option value="90d">Last 90 days</option>
          </select>
        </div>
      </div>
      {rows.length === 0 && <EmptyState title="No matching transactions" body="Try clearing filters. The ledger is the seeded demo set." />}
      <Card padded={false}>
        <ul className="divide-y divide-[var(--mm-border)]">
          {rows.map((t) => (
            <li key={t.txn_id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{t.merchant}</p>
                <p className="text-xs text-[var(--mm-muted)]">
                  {t.category} · {dayKey(t.posted_at)} · {t.account_id} · {t.source} {t.demo ? "· demo" : ""}
                </p>
                {t.note && <p className="text-xs text-[var(--mm-muted)]">{t.note}</p>}
              </div>
              <span className={`tabular font-semibold ${t.amount < 0 ? "" : "text-[var(--mm-success)]"}`}>
                {t.amount > 0 ? "+" : ""}
                {formatINR(t.amount)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {state.payments.length > 0 && (
        <Card>
          <h3 className="font-semibold">MeshPaL payments</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {state.payments.map((p) => (
              <li key={p.payment_id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{p.merchant_name} · {formatMoney(p.amount, p.currency)}</span>
                <Badge tone={p.status === "captured" || p.status === "settled" ? "success" : p.status === "denied" || p.status === "voided" ? "danger" : "warning"}>{p.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function SubscriptionsScreen({ state, run }: ScreenProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Subscriptions</h2>
        <p className="mt-1 text-sm text-[var(--mm-muted)]">
          Only subscriptions created through the MoneyMate Mesh merchant integration are managed. We do not intercept every
          renewal across a consumer PayPal account. Sandbox billing does not fire on cue — use the labelled replay button.
          Cancelling is simulated unless PayPal REST credentials are set; Braintree subscription plans are not configured in this demo.
        </p>
      </div>
      {state.subscriptions.length === 0 && (
        <EmptyState title="No managed subscriptions yet" body="Run scenario B (Subscription guardian) from the command bar or dashboard to seed CloudDraw, Logsense and StackMail under a $30/month mandate." />
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {state.subscriptions.map((s) => {
          const raised = raisedThisYear(s);
          const delta = annualizedDelta(s);
          return (
            <Card key={s.subscription_id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{s.plan_name}</h3>
                  <p className="text-sm text-[var(--mm-muted)]">{s.merchant_name}</p>
                </div>
                <Badge tone={lifecycleOf(s) === "ended" ? "danger" : lifecycleOf(s) === "suggested" ? "warning" : "success"}>{lifecycleOf(s)}</Badge>
              </div>
              <p className="mt-2 text-lg font-semibold tabular">{formatMoney(s.amount, s.currency)} / month</p>
              <p className="mt-1 text-xs text-[var(--mm-muted)]">
                Expected {formatMoney(s.expected_amount_min ?? s.amount, s.currency)}–{formatMoney(s.expected_amount_max ?? s.amount, s.currency)} · {s.bill_type || "subscription"}
              </p>
              <p className="mt-2 text-xs text-amber-700">
                Raised {raised} time{raised === 1 ? "" : "s"} this year · annualized delta {formatMoney(delta, s.currency)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {lifecycleOf(s) === "suggested" && (
                  <Button variant="secondary" onClick={() => run("Confirming…", async () => { await fetchJson(`/api/subscriptions/${s.subscription_id}/confirm`, { method: "POST" }); })}>
                    Confirm
                  </Button>
                )}
                {lifecycleOf(s) !== "ended" && (
                  <Button variant="danger" onClick={() => run("Cancelling…", async () => { await fetchJson(`/api/subscriptions/${s.subscription_id}/cancel`, { method: "POST" }); })}>
                    Cancel via PayPal
                  </Button>
                )}
                {s.merchant_id === "merchant_clouddraw" && lifecycleOf(s) !== "ended" && (
                  <Button variant="secondary" onClick={() => run("Replaying webhook…", async () => { await fetchJson("/api/subscriptions/replay", { method: "POST", body: JSON.stringify({ subscription_id: s.subscription_id, proposed_amount: 16 }) }); })}>
                    Replay webhook (price increase)
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {state.renewal_reviews?.filter((r) => r.intelligence).slice().reverse().map((r) => {
        const i = r.intelligence!;
        const pending = state.approvals.find((a) => a.approval_id === r.approval_id && a.status === "pending");
        const sub = state.subscriptions.find((s) => s.subscription_id === r.subscription_id);
        return (
          <Card key={r.review_id} className="border-amber-200">
            <p className="text-xs uppercase tracking-[0.16em] text-amber-700">Subscription Intelligence</p>
            <h3 className="mt-1 font-semibold">{sub?.plan_name || "Renewal"}</h3>
            <p className="mt-2 text-sm">
              {formatMoney(i.previous_monthly_price, i.currency)} → {formatMoney(i.new_monthly_price, i.currency)}{" "}
              ({i.percent_change > 0 ? "+" : ""}{i.percent_change}%)
            </p>
            <p className="mt-3 text-sm">
              <Badge tone={r.decision === "ALLOW" ? "success" : r.decision === "DENY" ? "danger" : "warning"}>{r.decision}</Badge> {r.reason}
            </p>
            {pending && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => run("Approving renewal…", async () => { await fetchJson(`/api/approvals/${pending.approval_id}/approve`, { method: "POST" }); })}>
                  Approve new price
                </Button>
                <Button variant="danger" onClick={() => run("Declining and cancelling…", async () => { await fetchJson(`/api/approvals/${pending.approval_id}/deny`, { method: "POST" }); })}>
                  Decline and cancel via PayPal
                </Button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function BudgetsScreen({ state }: ScreenProps) {
  const budgets = budgetProgress(state.finance);
  const spent = budgets.reduce((s, b) => s + b.spent, 0);
  const limit = budgets.reduce((s, b) => s + b.monthly_limit, 0);
  const onTrack = limit ? Math.round(((limit - spent) / limit) * 100) : 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Budgets</h2>
          <p className="text-sm text-[var(--mm-muted)]">Envelopes for {DEMO_MONTH}. Spent totals come from the seed ledger, not forecasts.</p>
        </div>
        <Donut percent={Math.max(0, onTrack)} label="Remaining" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {budgets.map((b) => (
          <Card key={b.budget_id}>
            <div className="flex justify-between gap-2">
              <h3 className="font-semibold">{b.category}</h3>
              <span className="tabular text-sm">
                {formatINR(b.spent)} / {formatINR(b.monthly_limit)}
              </span>
            </div>
            <div className="mt-3">
              <ProgressBar value={b.spent} max={b.monthly_limit} />
            </div>
            <p className="mt-2 text-xs text-[var(--mm-muted)]">
              Remaining {formatINR(b.remaining)} · {b.month} · actuals from posted seed transactions
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function CoachScreen({ state, chat, setChat, messages, analysis, askCoach, run, setPage }: ScreenProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <div className="flex items-start gap-3">
          <RobotMascot className="h-16 w-16 shrink-0" />
          <div>
            <h2 className="text-xl font-semibold">AI Coach — your personal finance assistant</h2>
            <p className="mt-1 text-sm text-[var(--mm-muted)]">
              The coach explains numbers that a deterministic engine already computed. It cannot pay — it can only propose an intent for MeshPaL.
            </p>
          </div>
        </div>
        <div className="mt-4 max-h-96 space-y-3 overflow-auto">
          {messages.length === 0 && (
            <p className="text-sm text-[var(--mm-muted)]">Try the launch prompt below. Offline fallback is clearly labelled when no AI key is set.</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className="rounded-2xl px-3 py-2 text-sm" style={{ background: m.role === "coach" ? "color-mix(in srgb, var(--mm-accent) 10%, var(--mm-surface))" : "var(--mm-subtle)" }}>
              <p className="text-[11px] uppercase tracking-wide text-[var(--mm-muted)]">{m.role === "user" ? "You" : "Coach"}</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans">{m.text}</pre>
            </div>
          ))}
        </div>
        <textarea
          className="mt-4 w-full rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg)] px-3 py-2 text-sm"
          rows={3}
          value={chat}
          onChange={(e) => setChat(e.target.value)}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={askCoach}>Ask coach</Button>
          <Button variant="secondary" onClick={() => setChat(MONEYMATE_DEMO_PROMPT)}>Load laptop prompt</Button>
        </div>
      </Card>
      <div className="space-y-4 lg:col-span-2">
        {analysis && (
          <Card>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Affordability</h3>
              <Badge tone={analysis.verdict === "NOT_RECOMMENDED" ? "danger" : analysis.verdict === "AFFORDABLE" ? "success" : "warning"}>
                {analysis.verdict.replaceAll("_", " ")}
              </Badge>
            </div>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-[var(--mm-muted)]">Amount</dt><dd className="tabular">{formatINR(analysis.request_amount)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--mm-muted)]">Available to spend</dt><dd className="tabular">{formatINR(analysis.available_to_spend)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--mm-muted)]">Safe limit</dt><dd className="tabular">{formatINR(analysis.safe_spending_limit)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--mm-muted)]">EOM with purchase</dt><dd className="tabular">{formatINR(analysis.projected_eom_balance_with_purchase)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--mm-muted)]">PayPal USD (demo FX)</dt><dd className="tabular">{formatMoney(analysis.fx.usd, "USD")}</dd></div>
            </dl>
            <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-[var(--mm-muted)]">
              {analysis.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            {analysis.tradeoffs.map((r, i) => <p key={i} className="mt-2 text-xs text-amber-700">{r}</p>)}
            <p className="mt-3 text-[11px] text-[var(--mm-muted)]">{analysis.fx.label}</p>
            {analysis.verdict !== "NOT_RECOMMENDED" && (
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() =>
                  run("Proposing payment intent…", async () => {
                    await fetchJson("/api/purchases", { method: "POST", body: JSON.stringify({ sku: "nova_14_65000", accept_tradeoffs: true }) });
                  }, "agents")
                }
              >
                Propose NovaBook 14 (intent only)
              </Button>
            )}
          </Card>
        )}
        <AiCallsPanel calls={state.ai_calls || []} />
      </div>
    </div>
  );
}

function AiCallsPanel({ calls }: { calls: AiCallLog[] }) {
  if (!calls.length) {
    return (
      <Card>
        <h3 className="font-semibold">AI / tool calls</h3>
        <p className="mt-2 text-sm text-[var(--mm-muted)]">Every LLM and tool invocation is logged here (model, latency, tokens). Empty until the coach runs.</p>
      </Card>
    );
  }
  return (
    <Card>
      <h3 className="font-semibold">AI / tool calls</h3>
      <ul className="mt-3 max-h-64 space-y-2 overflow-auto text-xs">
        {calls.slice(-12).reverse().map((c) => (
          <li key={c.call_id} className="rounded-xl border border-[var(--mm-border)] p-2">
            <div className="flex justify-between gap-2">
              <span>{c.kind} · {c.name}</span>
              <span className="text-[var(--mm-muted)]">{c.latency_ms} ms{c.model ? ` · ${c.model}` : ""}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function VaultScreen({ state, run }: ScreenProps) {
  const info = paymentModeLabel(state);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Payment Methods</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--mm-muted)]">
            Connection status and sandbox checkout. MoneyMate Mesh does not store card PANs or PayPal passwords. A payment
            method nonce is collected only at checkout when Braintree is configured. {DEMO_FX.label}
          </p>
        </div>
        <Badge tone={info.tone}>{info.label}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <h3 className="font-semibold">Environment</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-[var(--mm-muted)]">Payment rail</dt><dd>{info.label}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--mm-muted)]">Planner</dt><dd>{state.modes.planner.planner === "offline" ? "Offline coach" : `AI · ${state.modes.planner.model || "model"}`}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--mm-muted)]">Webhook</dt><dd>{state.modes.webhook || "not configured"}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-[var(--mm-muted)]">
            No live PayPal balance is imported. Saved-card rows from design mockups are not shown because this demo does not vault consumer instruments.
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold">Vault benefits (this demo)</h3>
          <ul className="mt-3 space-y-2 text-sm text-[var(--mm-muted)]">
            <li>Authorize then capture, only after policy and verification.</li>
            <li>Kill switch can freeze further agent spend immediately.</li>
            <li>Signed receipts and a hash-chained audit log after settlement.</li>
            <li>Sandbox only — never live money in this MVP.</li>
          </ul>
        </Card>
      </div>
      {state.payments.length === 0 && <EmptyState title="No payments yet" body="Run scenario A or propose a laptop from the coach." />}
      <ul className="space-y-3">
        {state.payments.map((p) => (
          <Card key={p.payment_id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{p.merchant_name} · {formatMoney(p.amount, p.currency)}</span>
              <Badge tone={p.status === "captured" || p.status === "settled" ? "success" : p.status === "denied" || p.status === "voided" ? "danger" : "warning"}>{p.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-[var(--mm-muted)]">
              {p.rail} {p.braintree?.mode || p.paypal?.mode ? `· ${p.braintree?.mode || p.paypal?.mode}` : ""} {(p.braintree?.settlement_amount ?? p.paypal?.settlement_amount) != null ? `· settled ${formatMoney((p.braintree?.settlement_amount ?? p.paypal?.settlement_amount) as number, "USD")}` : ""}
            </p>
            {(p.braintree?.fx_label || p.paypal?.fx_label) && <p className="mt-1 text-[11px] text-[var(--mm-muted)]">{p.braintree?.fx_label || p.paypal?.fx_label}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {p.status === "awaiting_buyer" && p.rail === "braintree_sandbox" && (state.modes.payment || "").startsWith("braintree") && (
                <BraintreeCheckout
                  paymentId={p.payment_id}
                  amountUsd={p.braintree?.settlement_amount ?? (p.currency === "INR" ? p.amount / 83 : p.amount)}
                  onComplete={() => run("Refreshing after sandbox payment…", async () => undefined)}
                />
              )}
              {p.status === "awaiting_buyer" && p.paypal?.approve_url && p.paypal.mode !== "mock" && p.rail !== "braintree_sandbox" && (
                <Button variant="secondary" href={p.paypal.approve_url}>Open PayPal approval</Button>
              )}
              {p.status === "awaiting_buyer" && (state.modes.payment || state.modes.paypal) === "mock" && (
                <Button onClick={() => run("Simulating buyer approval…", async () => { await fetchJson(`/api/payments/${p.payment_id}/simulate-buyer`, { method: "POST" }); })}>
                  Simulate sandbox approval
                </Button>
              )}
            </div>
          </Card>
        ))}
      </ul>
    </div>
  );
}

export function AgentsScreen({ state, run, runScenario, onToggleKillSwitch }: ScreenProps) {
  const mandates = state.mandates?.length ? state.mandates : state.mandate ? [state.mandate] : [];
  const pending = state.approvals.filter((a) => a.status === "pending");
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-[24px] px-6 py-5 text-white" style={{ background: "linear-gradient(120deg,var(--mm-accent),var(--mm-accent-2))" }}>
        <div className="flex items-center gap-4">
          <RobotMascot className="h-16 w-16" />
          <div>
            <h2 className="text-xl font-semibold">MeshPaL Agents</h2>
            <p className="text-sm text-white/80">Let AI handle the routine. You stay in control. Agents may propose; policy still decides ALLOW / REQUIRE_APPROVAL / DENY.</p>
          </div>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <h3 className="font-semibold">MoneyMate Coach</h3>
          <p className="mt-1 text-sm text-[var(--mm-muted)]">Read-only finance tools + propose_payment. Mode: {state.modes.planner.planner}.</p>
          <Badge tone="success">Active</Badge>
        </Card>
        <Card>
          <h3 className="font-semibold">Launch buyer</h3>
          <p className="mt-1 text-sm text-[var(--mm-muted)]">{state.goal?.objective || "Run scenario A to give this agent a $50 startup-tools goal."}</p>
          <Button className="mt-3" variant="secondary" onClick={() => runScenario("buy-safely", "vault")}>Run buy-safely</Button>
        </Card>
        <Card>
          <h3 className="font-semibold">Subscription guardian</h3>
          <p className="mt-1 text-sm text-[var(--mm-muted)]">Reviews managed renewals against a $30/month cap in the demo.</p>
          <Button className="mt-3" variant="secondary" onClick={() => runScenario("subscriptions", "subscriptions")}>Run guardian</Button>
        </Card>
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Kill switch</h3>
            <p className="text-sm text-[var(--mm-muted)]">Freezes all agent financial activity immediately until a human turns it off.</p>
          </div>
          <Button variant={state.settings.kill_switch ? "danger" : "secondary"} onClick={onToggleKillSwitch}>
            {state.settings.kill_switch ? "Kill switch is ON — release" : "Engage kill switch"}
          </Button>
        </div>
      </Card>
      <Card>
        <h3 className="font-semibold">Approval inbox</h3>
        {pending.length === 0 && <p className="mt-2 text-sm text-[var(--mm-muted)]">No pending approvals.</p>}
        <ApprovalList pending={pending} run={run} />
      </Card>
      <Card>
        <h3 className="font-semibold">Mandates</h3>
        <p className="mt-1 text-sm text-[var(--mm-muted)]">Ed25519-signed spending rules: total limit, per-tx limit, allowlists, recurring, minimum balance, expiry.</p>
        {mandates.length === 0 && <p className="mt-2 text-sm text-[var(--mm-muted)]">Run a demo scenario to create a signed mandate.</p>}
        <ul className="mt-3 space-y-3">
          {mandates.map((m) => (
            <li key={m.mandate_id} className="rounded-2xl border border-[var(--mm-border)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{m.title || m.mandate_id}</span>
                <Badge tone={m.status === "active" ? "success" : "danger"}>{m.status}</Badge>
              </div>
              <p className="mt-2 text-[var(--mm-muted)]">
                Total {formatMoney(m.max_total_spend, m.currency)} · per-tx {formatMoney(m.per_tx_limit ?? m.auto_approve_limit, m.currency)} · min balance {formatMoney(m.minimum_balance ?? 0, m.currency)} · recurring {m.allow_recurring ? "allowed" : "off"}
              </p>
              {m.status === "active" && (
                <button className="mt-2 text-xs text-[var(--mm-danger)]" onClick={() => run("Revoking mandate…", async () => { await fetchJson(`/api/mandates/${m.mandate_id}/revoke`, { method: "POST" }); })}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function ApprovalList({ pending, run }: { pending: Approval[]; run: RunFn }) {
  return (
    <ul className="mt-3 space-y-3">
      {pending.map((a) => (
        <li key={a.approval_id} className="rounded-2xl border border-[var(--mm-border)] p-3">
          <p className="font-medium">{a.merchant_name} · {formatMoney(a.amount, a.currency)}</p>
          <p className="mt-1 text-sm text-[var(--mm-muted)]">{a.reason}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => run("Approving…", async () => { await fetchJson(`/api/approvals/${a.approval_id}/approve`, { method: "POST" }); }, a.kind === "renewal" ? "subscriptions" : "vault")}>
              {a.kind === "renewal" ? "Approve new price" : "Approve"}
            </Button>
            <Button variant="secondary" onClick={() => run("Denying…", async () => { await fetchJson(`/api/approvals/${a.approval_id}/deny`, { method: "POST" }); }, a.kind === "renewal" ? "subscriptions" : undefined)}>
              {a.kind === "renewal" ? "Decline and cancel via PayPal" : "Deny"}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function InsightsScreen({ state, analysis, setPage }: ScreenProps) {
  const flow = monthlyCashFlow(state.finance);
  const prev = monthlyCashFlow(state.finance, "2026-10");
  const delta = prev.expenses ? Math.round(((flow.expenses - prev.expenses) / prev.expenses) * 100) : 0;
  const merchants = topMerchants(state.finance.transactions, DEMO_MONTH);
  const budgets = budgetProgress(state.finance);
  const health = Math.max(0, Math.min(100, 100 - Math.round((budgets.reduce((s, b) => s + b.spent, 0) / Math.max(1, budgets.reduce((s, b) => s + b.monthly_limit, 0))) * 100) + 40));
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold">Insights</h2>
          <p className="text-sm text-[var(--mm-muted)]">Facts are computed from the seed ledger. Forecasts and coach verdicts are labelled separately.</p>
        </div>
        <span className="text-xs text-[var(--mm-muted)]">{DEMO_MONTH} vs 2026-10</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Spending trend" value={`${delta > 0 ? "+" : ""}${delta}%`} hint="November-to-date vs October actuals (seed)" trendUp={delta <= 0} />
        <Card>
          <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--mm-muted)]">Top merchants</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {merchants.map(([name, amt]) => (
              <li key={name} className="flex justify-between gap-2">
                <span className="truncate">{name}</span>
                <span className="tabular">{formatINR(amt)}</span>
              </li>
            ))}
            {merchants.length === 0 && <li className="text-[var(--mm-muted)]">No November spend posted yet in the seed (bills may still be upcoming).</li>}
          </ul>
        </Card>
        <Card className="flex items-center gap-4">
          <Donut percent={health} label="Health" />
          <div>
            <h3 className="font-semibold">Financial health</h3>
            <p className="mt-1 text-xs text-[var(--mm-muted)]">Heuristic from remaining budget envelope. Not a credit score.</p>
          </div>
        </Card>
      </div>
      <Card>
        <h3 className="font-semibold">Key takeaways</h3>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--mm-muted)]">
          <li>This month&apos;s expenses are {formatINR(flow.expenses)} versus {formatINR(prev.expenses)} in October ({delta > 0 ? "up" : "down"} {Math.abs(delta)}%).</li>
          <li>Upcoming bills total {formatINR(state.finance.bills.reduce((s, b) => s + b.amount, 0))} before the next income of {formatINR(state.finance.profile.next_income_amount)} on 30 Nov 2026.</li>
          {analysis && <li>Laptop affordability verdict: {analysis.verdict.replaceAll("_", " ")}.</li>}
        </ul>
        <Button className="mt-4" variant="secondary" onClick={() => setPage("coach")}>Ask the coach</Button>
      </Card>
    </div>
  );
}

export function ReportsScreen({ state, run, verifyResult, setVerifyResult }: ScreenProps) {
  const flow = monthlyCashFlow(state.finance);
  const exportCsv = () => {
    const header = ["txn_id", "posted_at", "merchant", "category", "amount", "currency", "account_id", "source", "demo"];
    const lines = [header.join(",")].concat(
      state.finance.transactions.map((t) =>
        [t.txn_id, t.posted_at, csv(t.merchant), csv(t.category), t.amount, t.currency, t.account_id, t.source, String(t.demo)].join(","),
      ),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "moneymate-seed-transactions.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Reports</h2>
          <p className="text-sm text-[var(--mm-muted)]">Export the seeded ledger and inspect signed receipts plus the audit hash chain.</p>
        </div>
        <Button onClick={exportCsv}>Export seed transactions (CSV)</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Income" value={formatINR(flow.income)} hint={flow.month} />
        <MetricCard label="Expenses" value={formatINR(flow.expenses)} />
        <MetricCard label="Net" value={formatINR(flow.net)} />
        <MetricCard label="Net worth" value={formatINR(flow.net_worth)} />
      </div>
      <Card>
        <h3 className="font-semibold">Signed receipts</h3>
        {state.receipts.length === 0 && <p className="mt-2 text-sm text-[var(--mm-muted)]">Issue a receipt after a captured or settled payment.</p>}
        <ul className="mt-3 space-y-3">
          {state.receipts.map((r) => (
            <li key={r.receipt_id} className="rounded-2xl border border-[var(--mm-border)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{r.receipt_id}</span>
                <Badge>{r.outcome}</Badge>
              </div>
              <p className="mt-1 text-[var(--mm-muted)]">{r.summary}</p>
              <p className="mt-1 font-mono text-[11px] text-[var(--mm-muted)]">audit {r.audit_hash}</p>
              <button
                className="mt-2 text-xs text-[var(--mm-accent)]"
                onClick={() =>
                  run("Verifying receipt…", async () => {
                    const res = await fetchJson("/api/receipts/verify", { method: "POST", body: JSON.stringify({ receipt_id: r.receipt_id }) }) as { valid?: boolean };
                    setVerifyResult(res.valid ? `Receipt ${r.receipt_id} signature is valid.` : "Signature check failed.");
                  })
                }
              >
                Verify signature
              </button>
            </li>
          ))}
        </ul>
        {verifyResult && <p className="mt-3 text-sm">{verifyResult}</p>}
        <Button className="mt-4" variant="secondary" onClick={() => run("Issuing receipt…", async () => { await fetchJson("/api/receipts", { method: "POST", body: JSON.stringify({ goal_id: state.goal?.goal_id }) }); })}>
          Issue signed receipt for latest goal
        </Button>
      </Card>
      <Card>
        <h3 className="font-semibold">Audit log</h3>
        <ul className="mt-3 max-h-80 space-y-2 overflow-auto text-xs">
          {state.events.slice().reverse().map((e) => (
            <li key={e.event_id} className="rounded-xl border border-[var(--mm-border)] px-3 py-2">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{e.type}</span>
                <span className="text-[var(--mm-muted)]">{e.at}</span>
              </div>
              <p className="text-[var(--mm-muted)]">{e.message}</p>
              <p className="font-mono text-[10px] text-[var(--mm-muted)]">{e.hash}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function csv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function SettingsScreen(props: ScreenProps) {
  const { state, appearance, themeId, setAppearance, setThemeId, onToggleKillSwitch, onResetDemo, onOpenCommand } = props;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Settings</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <h3 className="font-semibold">Profile (demo)</h3>
          <p className="mt-2 text-sm">{DEMO_USER_NAME}</p>
          <p className="text-xs text-[var(--mm-muted)]">Seeded persona · not a real customer record. Design mockups used a different name; this app always shows the official demo user.</p>
          <p className="mt-2 text-xs text-[var(--mm-muted)]">As of {DEMO_AS_OF} (10 Nov 2026, noon IST).</p>
        </Card>
        <Card>
          <h3 className="font-semibold">Appearance</h3>
          <div className="mt-3 flex gap-2">
            <Button variant={appearance === "light" ? "primary" : "secondary"} onClick={() => setAppearance("light")}>Light</Button>
            <Button variant={appearance === "dark" ? "primary" : "secondary"} onClick={() => setAppearance("dark")}>Dark</Button>
          </div>
          <p className="mt-4 text-sm font-medium">Accent themes</p>
          <p className="text-xs text-[var(--mm-muted)]">Gradient presets inspired by a visual style study. They change color only — no extra product features.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(Object.values(ACCENT_THEMES) as (typeof ACCENT_THEMES)[AccentThemeId][]).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setThemeId(t.id)}
                className="rounded-xl p-2.5 text-left text-xs font-bold text-white"
                style={{
                  background: `linear-gradient(135deg,${t.accent},${t.accent2})`,
                  boxShadow: themeId === t.id ? "0 0 0 2px white, 0 0 0 4px var(--mm-ink)" : undefined,
                }}
              >
                {t.name}
                {themeId === t.id ? " ✓" : ""}
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <h3 className="font-semibold">Safety</h3>
          <p className="mt-1 text-sm text-[var(--mm-muted)]">Kill switch {state.settings.kill_switch ? "is engaged" : "is off"}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant={state.settings.kill_switch ? "danger" : "secondary"} onClick={onToggleKillSwitch}>
              {state.settings.kill_switch ? "Release kill switch" : "Engage kill switch"}
            </Button>
            <Button variant="secondary" onClick={onResetDemo}>Reset demo</Button>
            <Button variant="ghost" onClick={onOpenCommand}>Open command bar (⌘K)</Button>
          </div>
        </Card>
        <Card>
          <h3 className="font-semibold">Notifications</h3>
          <p className="mt-1 text-sm text-[var(--mm-muted)]">This MVP surfaces approvals in-app. Email or push notifications are not implemented.</p>
        </Card>
      </div>
    </div>
  );
}

export { paymentModeLabel };
