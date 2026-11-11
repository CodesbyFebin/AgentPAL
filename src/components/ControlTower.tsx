"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEMO_GOAL_TEXT } from "@/lib/catalog";
import type {
  Approval,
  EvidenceDraft,
  Goal,
  Mandate,
  Merchant,
  Payment,
  Plan,
  Receipt,
  AuditEvent,
  Verification,
} from "@/lib/types";
import type { PaymentMode } from "@/lib/payment-mode";
import { BraintreeCheckout } from "./BraintreeCheckout";
import { AuditGrid } from "./AuditGrid";

interface Budget {
  max: number;
  captured: number;
  remaining: number;
  auto_approve_limit: number;
}

interface State {
  goal: Goal | null;
  mandate: Mandate | null;
  plan: Plan | null;
  payments: Payment[];
  approvals: Approval[];
  verifications: Verification[];
  receipts: Receipt[];
  events: AuditEvent[];
  merchants: Merchant[];
  evidence: EvidenceDraft[];
  settings: { kill_switch: boolean; kill_switch_at?: string; public_key: string };
  budget: Budget | null;
  modes: {
    planner: { planner: "offline" | "ai"; model?: string };
    payment?: PaymentMode;
    paypal: "sandbox" | "mock";
    webhook?: string;
  };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export function ControlTower() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goalText, setGoalText] = useState(DEMO_GOAL_TEXT);
  const [budget, setBudget] = useState(50);
  const [explainQ, setExplainQ] = useState("Why was this blocked?");
  const [explanation, setExplanation] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await api<State>("/api/status");
    setState(data);
    return data;
  }, []);

  useEffect(() => {
    refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(label);
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const pending = state?.approvals.filter((a) => a.status === "pending") ?? [];
  const awaitingBuyer = state?.payments.filter((p) => p.status === "awaiting_buyer") ?? [];
  const receipt = state?.receipts[state.receipts.length - 1];
  const plannerLabel =
    state?.modes.planner.planner === "ai"
      ? `AI planner (${state.modes.planner.model})`
      : "Offline planner";

  const injectionDecision = useMemo(() => {
    return [...(state?.events ?? [])]
      .reverse()
      .find((e) => e.type === "policy.decision" && e.payload.merchant_id === "merchant_evil");
  }, [state]);

  return (
    <div className="relative min-h-screen">
      <div className="mesh-grid pointer-events-none absolute inset-0" />
      <header className="relative z-10 border-b border-white/10 bg-ink-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mesh-500/15 ring-1 ring-mesh-400/30">
              <span className="font-display text-lg text-mesh-400">A</span>
            </div>
            <div>
              <p className="font-display text-lg tracking-tight text-white">AgentPaL</p>
              <p className="text-xs text-zinc-400">Your AI. Your Money. Your Rules.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={state?.modes.planner.planner === "ai" ? "live" : "off"}>{plannerLabel}</Badge>
            <Badge tone={(state?.modes.payment || state?.modes.paypal) === "mock" ? "off" : "live"}>
              {(state?.modes.payment || "").startsWith("braintree")
                ? "Braintree sandbox"
                : state?.modes.paypal === "sandbox"
                  ? "PayPal sandbox"
                  : "Mock payments"}
            </Badge>
            <Badge tone={state?.settings.kill_switch ? "danger" : "ok"}>
              {state?.settings.kill_switch ? "Kill switch ON" : "Kill switch off"}
            </Badge>
            <button
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                state?.settings.kill_switch
                  ? "bg-white text-ink-950"
                  : "bg-rose-500 text-white shadow-[0_0_24px_rgba(244,63,94,0.35)]"
              }`}
              disabled={!!busy}
              onClick={() =>
                run("kill", async () => {
                  await api("/api/kill-switch", {
                    method: "POST",
                    body: JSON.stringify({ active: !state?.settings.kill_switch }),
                  });
                })
              }
            >
              {state?.settings.kill_switch ? "Release kill switch" : "Engage kill switch"}
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl space-y-8 px-6 py-8">
        <section className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-mesh-400">Control Tower</p>
            <h1 className="mt-2 font-display text-4xl leading-tight text-white md:text-5xl">
              A payment is not the outcome.
              <span className="block text-mesh-300">A verified outcome is.</span>
            </h1>
            <p className="mt-4 max-w-2xl text-zinc-400">
              AgentPaL lets you delegate a real-world goal to an AI agent under an Ed25519-signed
              mandate. The policy engine decides allow, block, or ask you. Micro-purchases can
              settle on a clearly labeled simulated x402 rail. Larger purchases use PayPal Orders
              v2 with <span className="text-zinc-200">intent=AUTHORIZE</span>, then capture only
              after verification passes.
            </p>
          </div>
          <BudgetMeter budget={state?.budget ?? null} />
        </section>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <h2 className="font-display text-xl text-white">Goal intake</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Describe the outcome and the budget. Or run the official demo scenario in one click.
            </p>
            <textarea
              className="mt-4 w-full rounded-xl border border-white/10 bg-ink-950/80 p-3 text-sm text-zinc-100 outline-none ring-mesh-400/40 focus:ring-2"
              rows={4}
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-sm text-zinc-400">
                Budget (USD)
                <input
                  type="number"
                  min={1}
                  className="mt-1 block w-32 rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                />
              </label>
              <button
                className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-50"
                disabled={!!busy}
                onClick={() =>
                  run("goal", async () => {
                    const { goal } = await api<{ goal: Goal }>("/api/goals", {
                      method: "POST",
                      body: JSON.stringify({ objective: goalText, budget }),
                    });
                    await api("/api/mandates", {
                      method: "POST",
                      body: JSON.stringify({
                        goal_id: goal.goal_id,
                        max_total_spend: budget,
                        auto_approve_limit: 10,
                        approved_merchants: ["merchant_001", "merchant_002"],
                        allowed_categories: ["api_credits", "domain"],
                      }),
                    });
                    const { plan } = await api<{ plan: Plan }>("/api/plans", {
                      method: "POST",
                      body: JSON.stringify({ goal_id: goal.goal_id }),
                    });
                    await api(`/api/plans/${plan.plan_id}/approve`, { method: "POST" });
                    for (const step of plan.steps) {
                      await api(`/api/steps/${step.step_id}/execute`, { method: "POST" });
                    }
                  })
                }
              >
                Create & execute plan
              </button>
              <button
                className="rounded-xl bg-mesh-500 px-5 py-2 text-sm font-semibold text-ink-950 shadow-glow hover:bg-mesh-400 disabled:opacity-50"
                disabled={!!busy}
                onClick={() =>
                  run("demo", async () => {
                    await api("/api/demo/run", { method: "POST" });
                  })
                }
              >
                {busy === "demo" ? "Running demo…" : "Run demo scenario"}
              </button>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="font-display text-xl text-white">Signed mandate</h2>
            {state?.mandate ? (
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Info label="Max total spend" value={`$${state.mandate.max_total_spend.toFixed(2)}`} />
                <Info label="Auto-approve limit" value={`$${state.mandate.auto_approve_limit.toFixed(2)}`} />
                <Info label="Status" value={state.mandate.status} />
                <Info label="Expires" value={new Date(state.mandate.expires_at).toLocaleString()} />
                <Info label="Allowlist" value={state.mandate.approved_merchants.join(", ")} />
                <Info label="Categories" value={state.mandate.allowed_categories.join(", ")} />
                <div className="col-span-2">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Ed25519 signature</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-mesh-300">{state.mandate.signature}</p>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-sm text-zinc-400">No mandate yet. Run the demo or create a goal.</p>
            )}
          </div>
        </section>

        <section className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl text-white">Agent plan</h2>
              <p className="text-sm text-zinc-400">
                {state?.plan
                  ? state.plan.planner === "offline"
                    ? "Generated by the offline (rule-based) planner. Set AI_API_KEY to use an OpenAI-compatible model."
                    : `Generated by the AI planner${state.plan.model ? ` (${state.plan.model})` : ""}.`
                  : "The planner turns the goal into purchase steps with a plain-English rationale."}
              </p>
            </div>
            {state?.plan && <Badge tone="ok">{state.plan.status}</Badge>}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {(state?.plan?.steps ?? []).map((step) => (
              <div key={step.step_id} className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-white">
                    {step.merchant_name} · ${step.amount.toFixed(2)}
                  </p>
                  <RailChip rail={step.rail} amount={step.amount} />
                </div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{step.rationale}</p>
              </div>
            ))}
            {!state?.plan && <p className="text-sm text-zinc-500">No plan yet.</p>}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <h2 className="font-display text-xl text-white">Approval inbox</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Purchases over the auto-approve limit wait here. In sandbox mode you will be sent to
              PayPal to approve the buyer payment. In mock mode you can simulate that step.
            </p>
            <div className="mt-4 space-y-3">
              {pending.length === 0 && awaitingBuyer.length === 0 && (
                <p className="text-sm text-zinc-500">Inbox is clear.</p>
              )}
              {pending.map((a) => (
                <div key={a.approval_id} className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                  <p className="text-white">
                    {a.merchant_name} · ${a.amount.toFixed(2)}
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">{a.reason}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="rounded-lg bg-mesh-500 px-3 py-1.5 text-sm font-medium text-ink-950 disabled:opacity-50"
                      disabled={!!busy}
                      onClick={() =>
                        run("approve", async () => {
                          await api(`/api/approvals/${a.approval_id}/approve`, { method: "POST" });
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                      disabled={!!busy}
                      onClick={() =>
                        run("deny", async () => {
                          await api(`/api/approvals/${a.approval_id}/deny`, { method: "POST" });
                        })
                      }
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
              {awaitingBuyer.map((p) => (
                <div key={p.payment_id} className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-4">
                  <p className="text-white">
                    {p.merchant_name} · waiting on {p.rail === "braintree_sandbox" ? "Braintree" : "PayPal"} {p.braintree?.mode || p.paypal?.mode} buyer approval
                  </p>
                  <p className="mt-1 font-mono text-xs text-zinc-500">order {p.braintree?.order_id || p.paypal?.order_id}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {p.status === "awaiting_buyer" && p.rail === "braintree_sandbox" && (state?.modes.payment || "").startsWith("braintree") && (
                      <BraintreeCheckout
                        paymentId={p.payment_id}
                        amountUsd={p.braintree?.settlement_amount ?? p.amount}
                        onComplete={() => run("buyer", async () => undefined)}
                      />
                    )}
                    {p.paypal?.approve_url && p.rail !== "braintree_sandbox" && (
                      <a
                        href={p.paypal.approve_url}
                        className="rounded-lg bg-sky-400 px-3 py-1.5 text-sm font-medium text-ink-950"
                      >
                        Open PayPal approve link
                      </a>
                    )}
                    {((state?.modes.payment || state?.modes.paypal) === "mock") && (
                      <button
                        className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                        disabled={!!busy}
                        onClick={() =>
                          run("buyer", async () => {
                            const approval = state?.approvals.find((a) => a.payment_id === p.payment_id);
                            if (!approval) throw new Error("No approval record for this payment");
                            await api(`/api/approvals/${approval.approval_id}/simulate-buyer`, {
                              method: "POST",
                            });
                          })
                        }
                      >
                        Simulate sandbox approval
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-6">
            <h2 className="font-display text-xl text-white">Why was this blocked?</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Answers come from the policy engine and audit log, not from a model guessing.
            </p>
            <div className="mt-4 flex gap-2">
              <input
                className="flex-1 rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white"
                value={explainQ}
                onChange={(e) => setExplainQ(e.target.value)}
              />
              <button
                className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white disabled:opacity-50"
                disabled={!!busy}
                onClick={() =>
                  run("explain", async () => {
                    const data = await api<{ explanation: string }>("/api/explain", {
                      method: "POST",
                      body: JSON.stringify({ question: explainQ }),
                    });
                    setExplanation(data.explanation);
                  })
                }
              >
                Explain
              </button>
            </div>
            {explanation && <p className="mt-4 text-sm leading-relaxed text-zinc-200">{explanation}</p>}
            {injectionDecision && (
              <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                <p className="font-medium">Prompt-injection merchant blocked</p>
                <p className="mt-1 text-rose-100/80">{String(injectionDecision.payload.reason || injectionDecision.message)}</p>
                <p className="mt-2 text-xs text-rose-200/70">
                  ShadowCart’s listing told the agent to ignore limits. AgentPaL Guard treated that text as
                  untrusted data and refused the payment.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl text-white">Task timeline</h2>
          <ol className="mt-4 space-y-2">
            {(state?.events ?? []).slice(-12).map((e) => (
              <li key={e.event_id} className="flex gap-3 text-sm">
                <span className="w-44 shrink-0 font-mono text-[11px] text-zinc-500">
                  {new Date(e.at).toLocaleTimeString()}
                </span>
                <span className="w-44 shrink-0 text-mesh-300">{e.type}</span>
                <span className="text-zinc-300">{e.message}</span>
              </li>
            ))}
            {!state?.events.length && <p className="text-sm text-zinc-500">No events yet.</p>}
          </ol>
        </section>

        <section className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl text-white">Catalog & Trust Passports</h2>
              <p className="text-sm text-zinc-400">
                Toggle “deliver bad artifact” on a merchant to show verification failure, then void or
                refund.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {(state?.merchants ?? []).map((m) => (
              <div key={m.merchant_id} className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-white">{m.name}</p>
                  <span className="font-mono text-xs text-mesh-300">{m.trust_passport.trust_score}</span>
                </div>
                <p className="mt-2 line-clamp-4 text-xs text-zinc-500">{m.description}</p>
                <p className="mt-2 text-xs text-zinc-400">
                  Refund {m.trust_passport.refund_policy} · dispute {m.trust_passport.dispute_rate}% ·
                  retention {m.trust_passport.data_retention}
                </p>
                {m.injection_bait && (
                  <p className="mt-2 text-xs text-rose-300">Injection-bait listing (will be blocked)</p>
                )}
                <label className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={m.fail_delivery}
                    onChange={(e) =>
                      run("merchant", async () => {
                        await api(`/api/merchants/${m.merchant_id}`, {
                          method: "POST",
                          body: JSON.stringify({ fail_delivery: e.target.checked }),
                        });
                      })
                    }
                  />
                  Deliver bad artifact
                </label>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl text-white">Audit log</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Append-only, hash-chained events. Every financial row is tagged “paid by agent on behalf of
            user.” Rendered with AG Grid Community.
          </p>
          <div className="mt-4">
            <AuditGrid events={state?.events ?? []} />
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl text-white">Unified signed receipt</h2>
              <button
                className="rounded-lg bg-mesh-500 px-3 py-1.5 text-sm font-medium text-ink-950 disabled:opacity-50"
                disabled={!!busy || !state?.goal}
                onClick={() =>
                  run("receipt", async () => {
                    await api("/api/receipts", {
                      method: "POST",
                      body: JSON.stringify({ goal_id: state?.goal?.goal_id }),
                    });
                  })
                }
              >
                Issue receipt
              </button>
            </div>
            {receipt ? (
              <div className="mt-4 space-y-3">
                <pre className="whitespace-pre-wrap rounded-xl bg-ink-950 p-4 font-mono text-xs text-zinc-300">
                  {receipt.summary}
                </pre>
                <p className="break-all font-mono text-[11px] text-mesh-300">audit {receipt.audit_hash}</p>
                <a
                  className="inline-block text-sm text-mesh-400 underline-offset-4 hover:underline"
                  href={`data:application/json,${encodeURIComponent(JSON.stringify(receipt, null, 2))}`}
                  download={`${receipt.receipt_id}.json`}
                >
                  Download receipt JSON
                </a>
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-500">
                After payments are verified, issue a receipt. It commits to the event chain with
                SHA-256 and an Ed25519 signature.
              </p>
            )}
          </div>

          <div className="card p-6">
            <h2 className="font-display text-xl text-white">Payments & verification</h2>
            <div className="mt-4 space-y-3">
              {(state?.payments ?? []).map((p) => {
                const v = state?.verifications.find((x) => x.payment_id === p.payment_id);
                return (
                  <div key={p.payment_id} className="rounded-xl border border-white/10 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-white">
                        {p.merchant_name} · ${p.amount.toFixed(2)} · {p.status}
                      </p>
                      <RailChip rail={p.rail} amount={p.amount} mock={p.paypal?.mode === "mock"} />
                    </div>
                    {v && (
                      <ul className="mt-2 text-xs text-zinc-400">
                        {v.checks.map((c) => (
                          <li key={c.name}>
                            {c.passed ? "✓" : "✗"} {c.name}: {c.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                    {(p.status === "voided" || v?.status === "failed") && (
                      <button
                        className="mt-2 rounded-lg bg-white/10 px-3 py-1 text-xs text-white"
                        disabled={!!busy}
                        onClick={() =>
                          run("evidence", async () => {
                            await api("/api/evidence", {
                              method: "POST",
                              body: JSON.stringify({ payment_id: p.payment_id }),
                            });
                          })
                        }
                      >
                        Draft dispute evidence
                      </button>
                    )}
                  </div>
                );
              })}
              {!state?.payments.length && <p className="text-sm text-zinc-500">No payments yet.</p>}
            </div>
            {(state?.evidence ?? []).length > 0 && (
              <div className="mt-4 rounded-xl bg-ink-950 p-4">
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  Latest evidence ({state!.evidence[state!.evidence.length - 1].source})
                </p>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-300">
                  {state!.evidence[state!.evidence.length - 1].body}
                </pre>
              </div>
            )}
          </div>
        </section>

        <footer className="pb-10 text-center text-xs text-zinc-600">
          AgentPaL is an independent hackathon project built on PayPal APIs. It is not a PayPal product and is not endorsed by PayPal. x402 in this demo is simulated. zkVM receipts and a live provider
          registry are on the roadmap, not in this MVP.
        </footer>
      </main>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "live" | "off" | "ok" | "danger";
}) {
  const cls =
    tone === "live"
      ? "bg-mesh-500/15 text-mesh-300 ring-mesh-400/30"
      : tone === "danger"
        ? "bg-rose-500/15 text-rose-300 ring-rose-400/30"
        : tone === "ok"
          ? "bg-white/5 text-zinc-300 ring-white/10"
          : "bg-amber-400/10 text-amber-200 ring-amber-400/20";
  return <span className={`rounded-full px-3 py-1 text-xs ring-1 ${cls}`}>{children}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-zinc-200">{value}</p>
    </div>
  );
}

function RailChip({ rail, amount, mock }: { rail: string; amount: number; mock?: boolean }) {
  if (rail === "x402_usdc") {
    return (
      <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] text-violet-200 ring-1 ring-violet-400/30">
        Simulated x402 · ${amount.toFixed(0)}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-200 ring-1 ring-sky-400/30">
      {mock ? "PayPal mock" : "PayPal sandbox"} · AUTHORIZE
    </span>
  );
}

function BudgetMeter({ budget }: { budget: Budget | null }) {
  const pct = budget ? Math.min(100, Math.round((budget.captured / budget.max) * 100)) : 0;
  return (
    <div className="card p-6 shadow-glow">
      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Live budget</p>
      <p className="mt-2 font-display text-4xl text-white">
        ${budget ? budget.captured.toFixed(2) : "0.00"}
        <span className="text-lg text-zinc-500"> / ${budget ? budget.max.toFixed(2) : "50.00"}</span>
      </p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-mesh-600 to-mesh-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 flex justify-between text-xs text-zinc-400">
        <span>{pct}% captured after verification</span>
        <span>${budget ? budget.remaining.toFixed(2) : "—"} remaining</span>
      </div>
      {budget && (
        <p className="mt-3 text-xs text-zinc-500">
          Auto-approve at or under ${budget.auto_approve_limit.toFixed(2)} per purchase.
        </p>
      )}
    </div>
  );
}
