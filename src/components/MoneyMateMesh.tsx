"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MONEYMATE_DEMO_PROMPT } from "@/lib/catalog";
import { budgetProgress, monthlyCashFlow } from "@/lib/finance-engine";
import { formatINR, formatMoney } from "@/lib/money";
import { annualizedDelta, lifecycleOf, raisedThisYear } from "@/lib/subscription-metrics";
import type {
  AffordabilityResult,
  Approval,
  AuditEvent,
  FinanceState,
  Mandate,
  ManagedSubscription,
  Payment,
  Receipt,
  RenewalReview,
  AiCallLog,
} from "@/lib/types";
import { AuditTrailGrid, TransactionsGrid } from "./LedgerGrids";

type Tab =
  | "overview"
  | "coach"
  | "agents"
  | "safety"
  | "payments"
  | "subscriptions"
  | "transactions"
  | "audit";

type Snapshot = {
  goal: { goal_id: string; objective: string; budget: number; currency: string } | null;
  mandate: Mandate | null;
  mandates?: Mandate[];
  plan: { plan_id: string; steps: unknown[]; planner: string } | null;
  payments: Payment[];
  approvals: Approval[];
  verifications: unknown[];
  receipts: Receipt[];
  events: AuditEvent[];
  merchants: { merchant_id: string; name: string; description: string; injection_bait: boolean }[];
  finance: FinanceState;
  subscriptions: ManagedSubscription[];
  renewal_reviews: RenewalReview[];
  ai_calls: AiCallLog[];
  webhook_receipts: unknown[];
  settings: { kill_switch: boolean; kill_switch_at?: string; public_key: string };
  modes: { planner: { planner: "offline" | "ai"; model?: string }; paypal: "sandbox" | "mock"; webhook?: string };
};

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "coach", label: "AI Money Coach" },
  { id: "agents", label: "Agent Center" },
  { id: "safety", label: "Mandates & Safety" },
  { id: "payments", label: "Payments" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "transactions", label: "Transactions" },
  { id: "audit", label: "Audit & Receipts" },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

function Badge({ children, tone = "mint" }: { children: React.ReactNode; tone?: "mint" | "amber" | "rose" | "zinc" }) {
  const cls =
    tone === "amber"
      ? "border-amber-400/40 text-amber-200"
      : tone === "rose"
        ? "border-rose-400/40 text-rose-200"
        : tone === "zinc"
          ? "border-white/15 text-zinc-300"
          : "border-mesh-500/40 text-mesh-300";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] uppercase tracking-wide ${cls}`}>{children}</span>;
}

function verdictTone(v?: string): "mint" | "amber" | "rose" {
  if (v === "AFFORDABLE") return "mint";
  if (v === "AFFORDABLE_WITH_TRADEOFFS") return "amber";
  return "rose";
}

export function MoneyMateMesh() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState(MONEYMATE_DEMO_PROMPT);
  const [messages, setMessages] = useState<Array<{ role: "user" | "coach"; text: string }>>([]);
  const [analysis, setAnalysis] = useState<AffordabilityResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await api<{ finance: FinanceState } & Snapshot>("/api/status");
    // mandates may only live on the store; status snapshot has mandate (latest) + we also fetch list
    const extras = await api<{ mandates: Mandate[] }>("/api/mandates");
    setState({ ...data, mandates: extras.mandates });
  }, []);

  useEffect(() => {
    refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<void>, next?: Tab) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh();
      if (next) setTab(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const runScenario = (scenario: string, next: Tab) =>
    run(`Running ${scenario}…`, async () => {
      await api("/api/demo/run", { method: "POST", body: JSON.stringify({ scenario }) });
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

  const budgets = useMemo(() => (state ? budgetProgress(state.finance) : []), [state]);

  if (!state) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16 text-zinc-400">
        Loading MoneyMate Mesh…
        {error && <p className="mt-3 text-rose-300">{error}</p>}
      </main>
    );
  }

  const paypalTone = state.modes.paypal === "mock" ? "amber" : "mint";
  const plannerTone = state.modes.planner.planner === "offline" ? "amber" : "mint";
  const pending = state.approvals.filter((a) => a.status === "pending");

  return (
    <div className="min-h-screen pb-24 md:pb-10">
      <header className="border-b border-white/10 bg-ink-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-mesh-400">MoneyMate Mesh</p>
            <h1 className="font-display text-2xl text-white md:text-3xl">Your AI. Your Money. Your Rules.</h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">
              MoneyMate is the financial brain. MeshPaL is the trust and execution layer. Together they let an AI propose,
              you approve, and the backend verify — including a real PayPal sandbox checkout.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="zinc">Demo data</Badge>
            <Badge tone={paypalTone}>{state.modes.paypal === "mock" ? "Mock PayPal" : "PayPal sandbox"}</Badge>
            <Badge tone={plannerTone}>
              {state.modes.planner.planner === "offline" ? "Offline coach" : `AI · ${state.modes.planner.model || "model"}`}
            </Badge>
            {state.settings.kill_switch && <Badge tone="rose">Kill switch on</Badge>}
            <button
              type="button"
              className="rounded-full border border-amber-400/40 px-3 py-1 text-xs text-amber-100"
              onClick={() =>
                run("Resetting demo…", async () => {
                  await api("/api/demo/reset", { method: "POST" });
                  setMessages([]);
                  setAnalysis(null);
                }, "overview")
              }
            >
              Reset demo
            </button>
          </div>
        </div>
        <nav className="mx-auto hidden max-w-6xl gap-1 px-4 pb-3 md:flex md:flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3 py-1.5 text-sm ${tab === t.id ? "bg-mesh-500/20 text-mesh-300" : "text-zinc-400 hover:text-white"}`}
            >
              {t.label}
              {t.id === "safety" && pending.length > 0 ? ` (${pending.length})` : ""}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {error && <div className="rounded-xl border border-rose-400/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">{error}</div>}
        {busy && <div className="text-sm text-mesh-300">{busy}</div>}

        <p className="rounded-xl border border-amber-400/20 bg-amber-950/30 px-4 py-3 text-xs text-amber-100">
          All balances, transactions, budgets, bills and subscriptions shown here are seeded demo data, not a live bank or
          personal PayPal history. MoneyMate Mesh is a hackathon project built on PayPal APIs and is not a PayPal product
          or endorsement.
        </p>

        {tab === "overview" && (
          <section className="space-y-6">
            <div className="grid gap-3 md:grid-cols-3">
              {state.finance.accounts.map((a) => (
                <article key={a.account_id} className="card p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{a.institution}</p>
                  <h2 className="mt-1 font-display text-lg text-white">{a.name}</h2>
                  <p className="mt-2 font-display text-2xl text-mesh-300">{formatINR(a.balance)}</p>
                  <p className="mt-1 text-xs text-zinc-500">Demo snapshot as of 10 Nov 2026, noon IST</p>
                </article>
              ))}
              <article className="card p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Next salary</p>
                <h2 className="mt-1 font-display text-lg text-white">Income</h2>
                <p className="mt-2 font-display text-2xl text-white">{formatINR(state.finance.profile.next_income_amount)}</p>
                <p className="mt-1 text-xs text-zinc-500">Expected 30 Nov 2026</p>
              </article>
            </div>


            {(() => {
              const flow = monthlyCashFlow(state.finance);
              return (
                <article className="card p-5">
                  <h3 className="font-display text-lg text-white">This month&apos;s cash flow</h3>
                  <p className="mt-1 text-xs text-zinc-500">{flow.month} · transfers excluded from income and expenses</p>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm text-zinc-300 md:grid-cols-5">
                    <div><dt className="text-xs text-zinc-500">Income</dt><dd className="text-mesh-300">{formatINR(flow.income)}</dd></div>
                    <div><dt className="text-xs text-zinc-500">Expenses</dt><dd className="text-rose-300">{formatINR(flow.expenses)}</dd></div>
                    <div><dt className="text-xs text-zinc-500">Transfers</dt><dd>{formatINR(flow.transfers)}</dd></div>
                    <div><dt className="text-xs text-zinc-500">Net</dt><dd>{formatINR(flow.net)}</dd></div>
                    <div><dt className="text-xs text-zinc-500">Net worth</dt><dd>{formatINR(flow.net_worth)}</dd></div>
                  </dl>
                </article>
              );
            })()}

            <div className="grid gap-4 md:grid-cols-2">
              <article className="card p-5">
                <h3 className="font-display text-lg text-white">Monthly budgets</h3>
                <ul className="mt-3 space-y-2">
                  {budgets.map((b) => {
                    const pct = Math.min(100, Math.round((b.spent / b.monthly_limit) * 100));
                    return (
                      <li key={b.budget_id}>
                        <div className="flex justify-between text-xs text-zinc-400">
                          <span>{b.category}</span>
                          <span>
                            {formatINR(b.spent)} / {formatINR(b.monthly_limit)}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div className={`h-full ${pct > 90 ? "bg-rose-400" : "bg-mesh-500"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </article>
              <article className="card p-5">
                <h3 className="font-display text-lg text-white">Savings goals & upcoming bills</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {state.finance.savings_goals.map((g) => (
                    <li key={g.savings_goal_id} className="flex justify-between gap-3 text-zinc-300">
                      <span>{g.name}</span>
                      <span className="text-zinc-400">
                        {formatINR(g.current_amount)} · {formatINR(g.monthly_contribution)} left this month
                      </span>
                    </li>
                  ))}
                </ul>
                <ul className="mt-4 space-y-1 text-sm text-zinc-300">
                  {state.finance.bills.map((b) => (
                    <li key={b.bill_id} className="flex justify-between">
                      <span>{b.name}</span>
                      <span>
                        {formatINR(b.amount)} · due {b.due_at.slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            </div>

            <article className="card p-5">
              <h3 className="font-display text-lg text-white">Hackathon demos</h3>
              <p className="mt-1 text-sm text-zinc-400">Each run resets the demo store and walks one judged scenario.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="rounded-full bg-mesh-500 px-4 py-2 text-sm font-medium text-ink-950" onClick={() => runScenario("buy-safely", "payments")}>
                  A · Buy safely ($50)
                </button>
                <button className="rounded-full border border-white/20 px-4 py-2 text-sm" onClick={() => runScenario("malicious", "safety")}>
                  C · Malicious merchant
                </button>
                <button className="rounded-full border border-white/20 px-4 py-2 text-sm" onClick={() => runScenario("subscriptions", "subscriptions")}>
                  B · Subscription guardian
                </button>
                <button className="rounded-full border border-mesh-500/40 px-4 py-2 text-sm text-mesh-300" onClick={() => { setChat(MONEYMATE_DEMO_PROMPT); setTab("coach"); }}>
                  Laptop affordability
                </button>
              </div>
            </article>
          </section>
        )}

        {tab === "coach" && (
          <section className="grid gap-4 lg:grid-cols-5">
            <div className="card p-5 lg:col-span-3">
              <h2 className="font-display text-xl text-white">AI Money Coach</h2>
              <p className="mt-1 text-sm text-zinc-400">
                The coach explains numbers that a deterministic engine already computed. It cannot pay — it can only propose an intent for MeshPaL.
              </p>
              <div className="mt-4 max-h-80 space-y-3 overflow-auto">
                {messages.length === 0 && (
                  <p className="text-sm text-zinc-500">Try the launch prompt below. Offline fallback is clearly labelled when no AI key is set.</p>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "bg-white/5 text-zinc-200" : "bg-mesh-500/10 text-zinc-100"}`}>
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">{m.role === "user" ? "You" : "Coach"}</p>
                    <pre className="mt-1 whitespace-pre-wrap font-sans">{m.text}</pre>
                  </div>
                ))}
              </div>
              <textarea
                className="mt-4 w-full rounded-xl border border-white/10 bg-ink-950 px-3 py-2 text-sm"
                rows={3}
                value={chat}
                onChange={(e) => setChat(e.target.value)}
              />
              <button className="mt-3 rounded-full bg-mesh-500 px-4 py-2 text-sm font-medium text-ink-950" onClick={askCoach}>
                Ask coach
              </button>
            </div>
            <div className="space-y-4 lg:col-span-2">
              {analysis && (
                <article className="card p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-lg text-white">Affordability</h3>
                    <Badge tone={verdictTone(analysis.verdict)}>{analysis.verdict.replaceAll("_", " ")}</Badge>
                  </div>
                  <dl className="mt-3 space-y-1 text-sm text-zinc-300">
                    <div className="flex justify-between"><dt>Amount</dt><dd>{formatINR(analysis.request_amount)}</dd></div>
                    <div className="flex justify-between"><dt>Available to spend</dt><dd>{formatINR(analysis.available_to_spend)}</dd></div>
                    <div className="flex justify-between"><dt>Safe limit</dt><dd>{formatINR(analysis.safe_spending_limit)}</dd></div>
                    <div className="flex justify-between"><dt>EOM with purchase</dt><dd>{formatINR(analysis.projected_eom_balance_with_purchase)}</dd></div>
                    <div className="flex justify-between"><dt>PayPal USD (demo FX)</dt><dd>{formatMoney(analysis.fx.usd, "USD")}</dd></div>
                  </dl>
                  <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-zinc-400">
                    {analysis.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                  {analysis.tradeoffs.map((r, i) => <p key={i} className="mt-2 text-xs text-amber-200">{r}</p>)}
                  <p className="mt-3 text-[11px] text-zinc-500">{analysis.fx.label}</p>
                  {analysis.verdict !== "NOT_RECOMMENDED" && (
                    <button
                      className="mt-3 rounded-full border border-mesh-500/40 px-3 py-1.5 text-xs text-mesh-300"
                      onClick={() =>
                        run("Proposing payment intent…", async () => {
                          await api("/api/purchases", {
                            method: "POST",
                            body: JSON.stringify({ sku: "nova_14_65000", accept_tradeoffs: true }),
                          });
                        }, "safety")
                      }
                    >
                      Propose NovaBook 14 (intent only)
                    </button>
                  )}
                </article>
              )}
              <AiCallsPanel calls={state.ai_calls || []} />
            </div>
          </section>
        )}

        {tab === "agents" && (
          <section className="card p-5">
            <h2 className="font-display text-xl text-white">Agent Center</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Agents may propose purchases and plans. MeshPaL policy still decides ALLOW / REQUIRE_APPROVAL / DENY. The coach&apos;s only write tool is propose_payment, which never captures funds.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 p-4">
                <h3 className="text-white">MoneyMate Coach</h3>
                <p className="mt-1 text-sm text-zinc-400">Read-only finance tools + propose_payment. Mode: {state.modes.planner.planner}.</p>
              </div>
              <div className="rounded-xl border border-white/10 p-4">
                <h3 className="text-white">Launch buyer</h3>
                <p className="mt-1 text-sm text-zinc-400">{state.goal?.objective || "Run scenario A to give this agent a $50 startup-tools goal."}</p>
              </div>
            </div>
          </section>
        )}

        {tab === "safety" && (
          <SafetyPanel
            state={state}
            pending={pending}
            onRefresh={refresh}
            run={run}
          />
        )}

        {tab === "payments" && <PaymentsPanel state={state} run={run} />}

        {tab === "subscriptions" && <SubscriptionsPanel state={state} run={run} />}

        {tab === "transactions" && (
          <TransactionsGrid transactions={state.finance.transactions} payments={state.payments} receipts={state.receipts} />
        )}

        {tab === "audit" && (
          <section className="space-y-6">
            <AuditTrailGrid events={state.events} />
            <article className="card p-5">
              <h3 className="font-display text-lg text-white">Signed receipts</h3>
              {state.receipts.length === 0 && <p className="mt-2 text-sm text-zinc-500">Issue a receipt after a captured or settled payment.</p>}
              <ul className="mt-3 space-y-3">
                {state.receipts.map((r) => (
                  <li key={r.receipt_id} className="rounded-xl border border-white/10 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-white">{r.receipt_id}</span>
                      <Badge>{r.outcome}</Badge>
                    </div>
                    <p className="mt-1 text-zinc-400">{r.summary}</p>
                    <p className="mt-1 font-mono text-[11px] text-zinc-500">audit {r.audit_hash}</p>
                    <button
                      className="mt-2 text-xs text-mesh-300"
                      onClick={() =>
                        run("Verifying receipt…", async () => {
                          const res = await api<{ valid: boolean }>("/api/receipts/verify", {
                            method: "POST",
                            body: JSON.stringify({ receipt_id: r.receipt_id }),
                          });
                          setVerifyResult(res.valid ? `Receipt ${r.receipt_id} signature is valid.` : "Signature check failed.");
                        })
                      }
                    >
                      Verify signature
                    </button>
                  </li>
                ))}
              </ul>
              {verifyResult && <p className="mt-3 text-sm text-mesh-300">{verifyResult}</p>}
              <button
                className="mt-4 rounded-full border border-white/20 px-3 py-1.5 text-sm"
                onClick={() =>
                  run("Issuing receipt…", async () => {
                    await api("/api/receipts", { method: "POST", body: JSON.stringify({ goal_id: state.goal?.goal_id }) });
                  })
                }
              >
                Issue signed receipt for latest goal
              </button>
            </article>
          </section>
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-white/10 bg-ink-950/95 p-2 md:hidden">
        {([
          ["overview", "Overview"],
          ["coach", "Coach"],
          ["safety", pending.length ? `Approvals (${pending.length})` : "Approvals"],
          ["payments", "Wallet"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={`py-2 text-xs ${tab === id ? "text-mesh-300" : "text-zinc-400"}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function AiCallsPanel({ calls }: { calls: AiCallLog[] }) {
  if (!calls.length) {
    return (
      <article className="card p-5">
        <h3 className="font-display text-lg text-white">AI / tool calls</h3>
        <p className="mt-2 text-sm text-zinc-500">Every LLM and tool invocation is logged here (model, latency, tokens). Empty until the coach runs.</p>
      </article>
    );
  }
  return (
    <article className="card p-5">
      <h3 className="font-display text-lg text-white">AI / tool calls</h3>
      <ul className="mt-3 max-h-64 space-y-2 overflow-auto text-xs">
        {calls.slice(-12).reverse().map((c) => (
          <li key={c.call_id} className="rounded-lg border border-white/10 p-2 text-zinc-300">
            <div className="flex justify-between gap-2">
              <span>{c.kind} · {c.name}</span>
              <span className="text-zinc-500">{c.latency_ms} ms{c.model ? ` · ${c.model}` : ""}</span>
            </div>
            {(c.prompt_tokens || c.completion_tokens) && (
              <p className="text-zinc-500">tokens {c.prompt_tokens ?? "—"} / {c.completion_tokens ?? "—"}</p>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}

function SafetyPanel({
  state,
  pending,
  run,
}: {
  state: Snapshot;
  pending: Approval[];
  onRefresh: () => Promise<void>;
  run: (label: string, fn: () => Promise<void>, next?: Tab) => Promise<void>;
}) {
  const mandates = state.mandates?.length ? state.mandates : state.mandate ? [state.mandate] : [];
  return (
    <section className="space-y-6">
      <article className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl text-white">Kill switch</h2>
          <button
            className={`rounded-full px-4 py-2 text-sm ${state.settings.kill_switch ? "bg-rose-500 text-white" : "border border-rose-400/40 text-rose-200"}`}
            onClick={() =>
              run("Updating kill switch…", async () => {
                await api("/api/kill-switch", { method: "POST", body: JSON.stringify({ active: !state.settings.kill_switch }) });
              })
            }
          >
            {state.settings.kill_switch ? "Kill switch is ON — release" : "Engage kill switch"}
          </button>
        </div>
        <p className="mt-2 text-sm text-zinc-400">Freezes all agent financial activity immediately until a human turns it off.</p>
      </article>

      <article className="card p-5">
        <h2 className="font-display text-xl text-white">Approval inbox</h2>
        {pending.length === 0 && <p className="mt-2 text-sm text-zinc-500">No pending approvals.</p>}
        <ul className="mt-3 space-y-3">
          {pending.map((a) => (
            <li key={a.approval_id} className="rounded-xl border border-white/10 p-3">
              <p className="text-white">{a.merchant_name} · {formatMoney(a.amount, a.currency)}</p>
              <p className="mt-1 text-sm text-zinc-400">{a.reason}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded-full bg-mesh-500 px-3 py-1 text-xs text-ink-950"
                  onClick={() => run("Approving…", async () => { await api(`/api/approvals/${a.approval_id}/approve`, { method: "POST" }); }, a.kind === "renewal" ? "subscriptions" : "payments")}
                >
                  {a.kind === "renewal" ? "Approve new price" : "Approve"}
                </button>
                <button
                  className="rounded-full border border-white/20 px-3 py-1 text-xs"
                  onClick={() => run("Denying…", async () => { await api(`/api/approvals/${a.approval_id}/deny`, { method: "POST" }); }, a.kind === "renewal" ? "subscriptions" : undefined)}
                >
                  {a.kind === "renewal" ? "Decline and cancel via PayPal" : "Deny"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </article>

      <article className="card p-5">
        <h2 className="font-display text-xl text-white">Mandates</h2>
        <p className="mt-1 text-sm text-zinc-400">Ed25519-signed spending rules: total limit, per-tx limit, allowlists, recurring, minimum balance, expiry.</p>
        {mandates.length === 0 && <p className="mt-2 text-sm text-zinc-500">Run a demo scenario to create a signed mandate.</p>}
        <ul className="mt-3 space-y-3">
          {mandates.map((m) => (
            <li key={m.mandate_id} className="rounded-xl border border-white/10 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-white">{m.title || m.mandate_id}</span>
                <Badge tone={m.status === "active" ? "mint" : "rose"}>{m.status}</Badge>
              </div>
              <p className="mt-2 text-zinc-400">
                Total {formatMoney(m.max_total_spend, m.currency)} · per-tx {formatMoney(m.per_tx_limit ?? m.auto_approve_limit, m.currency)} · min balance {formatMoney(m.minimum_balance ?? 0, m.currency)} · recurring {m.allow_recurring ? "allowed" : "off"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Merchants: {m.approved_merchants.join(", ")}</p>
              <p className="text-xs text-zinc-500">Categories: {m.allowed_categories.join(", ")}</p>
              <p className="text-xs text-zinc-500">Expires {m.expires_at}</p>
              {m.status === "active" && (
                <button
                  className="mt-2 text-xs text-rose-300"
                  onClick={() => run("Revoking mandate…", async () => { await api(`/api/mandates/${m.mandate_id}/revoke`, { method: "POST" }); })}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}

function PaymentsPanel({
  state,
  run,
}: {
  state: Snapshot;
  run: (label: string, fn: () => Promise<void>, next?: Tab) => Promise<void>;
}) {
  return (
    <section className="card p-5">
      <h2 className="font-display text-xl text-white">Payments</h2>
      <p className="mt-1 text-sm text-zinc-400">
        PayPal Orders v2 uses intent=AUTHORIZE, then capture only after outcome verification. INR checkouts are converted at the labelled demo FX rate because PayPal REST does not list INR.
      </p>
      {state.payments.length === 0 && <p className="mt-3 text-sm text-zinc-500">No payments yet. Run scenario A or propose a laptop from the coach.</p>}
      <ul className="mt-4 space-y-3">
        {state.payments.map((p) => (
          <li key={p.payment_id} className="rounded-xl border border-white/10 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-white">{p.merchant_name} · {formatMoney(p.amount, p.currency)}</span>
              <Badge tone={p.status === "captured" || p.status === "settled" ? "mint" : p.status === "denied" || p.status === "voided" ? "rose" : "amber"}>{p.status}</Badge>
            </div>
            <p className="mt-1 text-zinc-400">
              {p.rail} {p.paypal?.mode ? `· ${p.paypal.mode}` : ""} {p.paypal?.settlement_amount != null ? `· settled ${formatMoney(p.paypal.settlement_amount, "USD")}` : ""}
            </p>
            {p.paypal?.fx_label && <p className="mt-1 text-[11px] text-zinc-500">{p.paypal.fx_label}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {p.status === "awaiting_buyer" && p.paypal?.approve_url && p.paypal.mode !== "mock" && (
                <a className="rounded-full border border-white/20 px-3 py-1 text-xs" href={p.paypal.approve_url}>
                  Open PayPal approval
                </a>
              )}
              {p.status === "awaiting_buyer" && (p.paypal?.mode === "mock" || state.modes.paypal === "mock") && (
                <button
                  className="rounded-full bg-mesh-500 px-3 py-1 text-xs text-ink-950"
                  onClick={() => run("Simulating buyer approval…", async () => { await api(`/api/payments/${p.payment_id}/simulate-buyer`, { method: "POST" }); })}
                >
                  Simulate sandbox approval
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SubscriptionsPanel({
  state,
  run,
}: {
  state: Snapshot;
  run: (label: string, fn: () => Promise<void>, next?: Tab) => Promise<void>;
}) {
  return (
    <section className="space-y-4">
      <p className="rounded-xl border border-white/10 bg-ink-800/60 px-4 py-3 text-sm text-zinc-300">
        Only subscriptions created through the MoneyMate Mesh merchant integration are managed. We do not intercept every renewal across a consumer PayPal account.
        Sandbox billing does not fire on cue — use the labelled replay button.
      </p>
      {state.subscriptions.length === 0 && (
        <p className="text-sm text-zinc-500">Run scenario B to seed CloudDraw, Logsense and StackMail under a $30/month mandate.</p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {state.subscriptions.map((s) => {
          const raised = raisedThisYear(s);
          const delta = annualizedDelta(s);
          return (
            <article key={s.subscription_id} className="card p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-lg text-white">{s.plan_name}</h3>
                  <p className="text-sm text-zinc-400">{s.merchant_name}</p>
                </div>
                <Badge tone={lifecycleOf(s) === "ended" ? "rose" : lifecycleOf(s) === "suggested" ? "amber" : "mint"}>{lifecycleOf(s)}</Badge>
              </div>
              <p className="mt-2 text-mesh-300">{formatMoney(s.amount, s.currency)} / month</p>
              <p className="mt-1 text-xs text-zinc-500">
                Expected {formatMoney(s.expected_amount_min ?? s.amount, s.currency)}–{formatMoney(s.expected_amount_max ?? s.amount, s.currency)} · {s.bill_type || "subscription"}
              </p>
              <p className="mt-2 text-xs text-amber-200">
                Raised {raised} time{raised === 1 ? "" : "s"} this year · annualized delta {formatMoney(delta, s.currency)}
              </p>
              {(s.price_history || []).length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-zinc-400">
                  {s.price_history.map((c) => (
                    <li key={c.change_id}>
                      {formatMoney(c.previous, s.currency)} → {formatMoney(c.next, s.currency)} on {c.effective_at.slice(0, 10)} ({c.source}{c.material ? ", material" : ""})
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {lifecycleOf(s) === "suggested" && (
                  <button className="rounded-full border border-white/20 px-3 py-1 text-xs" onClick={() => run("Confirming…", async () => { await api(`/api/subscriptions/${s.subscription_id}/confirm`, { method: "POST" }); })}>
                    Confirm
                  </button>
                )}
                {lifecycleOf(s) !== "ended" && (
                  <button className="rounded-full border border-rose-400/30 px-3 py-1 text-xs text-rose-200" onClick={() => run("Cancelling…", async () => { await api(`/api/subscriptions/${s.subscription_id}/cancel`, { method: "POST" }); })}>
                    Cancel via PayPal
                  </button>
                )}
                {s.merchant_id === "merchant_clouddraw" && lifecycleOf(s) !== "ended" && (
                  <button className="rounded-full border border-mesh-500/40 px-3 py-1 text-xs text-mesh-300" onClick={() => run("Replaying webhook…", async () => { await api("/api/subscriptions/replay", { method: "POST", body: JSON.stringify({ subscription_id: s.subscription_id, proposed_amount: 16 }) }); })}>
                    Replay webhook (price increase)
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {state.renewal_reviews?.filter((r) => r.intelligence).slice().reverse().map((r) => {
        const i = r.intelligence;
        const pending = state.approvals.find((a) => a.approval_id === r.approval_id && a.status === "pending");
        const sub = state.subscriptions.find((s) => s.subscription_id === r.subscription_id);
        return (
          <article key={r.review_id} className="card border border-amber-400/30 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-amber-200">Subscription Intelligence</p>
            <h3 className="mt-1 font-display text-lg text-white">{sub?.plan_name || "Renewal"}</h3>
            <p className="mt-2 text-sm text-zinc-200">
              {formatMoney(i.previous_monthly_price, i.currency)} → {formatMoney(i.new_monthly_price, i.currency)}{" "}
              ({i.percent_change > 0 ? "+" : ""}{i.percent_change}%, {i.monthly_increase >= 0 ? "+" : ""}{formatMoney(i.monthly_increase, i.currency)}/mo, {i.annual_increase >= 0 ? "+" : ""}{formatMoney(i.annual_increase, i.currency)}/yr)
            </p>
            <dl className="mt-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
              <div>Mandate cap <span className="text-white">{formatMoney(i.mandate_limit, i.currency)}</span></div>
              <div>Other subscriptions <span className="text-white">{formatMoney(i.other_subscriptions_total, i.currency)}</span></div>
              <div>Projected monthly total <span className="text-white">{formatMoney(i.projected_total, i.currency)}</span></div>
              <div>Exceeds mandate by <span className={i.exceeds_by > 0 ? "text-rose-300" : "text-mesh-300"}>{formatMoney(Math.max(0, i.exceeds_by), i.currency)}</span></div>
            </dl>
            <p className="mt-3 text-sm text-zinc-400">
              <Badge tone={r.decision === "ALLOW" ? "mint" : r.decision === "DENY" ? "rose" : "amber"}>{r.decision}</Badge> {r.reason}
            </p>
            {pending && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded-full bg-mesh-500 px-3 py-1 text-xs text-ink-950"
                  onClick={() => run("Approving renewal…", async () => { await api(`/api/approvals/${pending.approval_id}/approve`, { method: "POST" }); })}
                >
                  Approve new price
                </button>
                <button
                  className="rounded-full border border-rose-400/40 px-3 py-1 text-xs text-rose-200"
                  onClick={() => run("Declining and cancelling…", async () => { await api(`/api/approvals/${pending.approval_id}/deny`, { method: "POST" }); })}
                >
                  Decline and cancel via PayPal
                </button>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
