"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState } from "@/components/ui/kit";
import type { ScreenProps } from "@/components/screens/Screens";
import { REPOS, SNIPPETS } from "@/components/screens/Phase2Screens";
import { PayLaterMessage } from "@/components/PayLaterMessage";
import { financeAnalytics, guardAnalytics } from "@/lib/analytics";
import { formatINR, formatMoney } from "@/lib/money";
import type { Payment, RefundRecord } from "@/lib/types";

/* ------------------------------ shared helpers ------------------------------ */

async function getJson<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, body };
}

function useJson<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const r = await getJson<T & { error?: string }>(path);
    if (r.ok) {
      setData(r.body);
      setError(null);
    } else setError((r.body as { error?: string }).error || `HTTP ${r.status}`);
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}

function Header({ title, sub, badge }: { title: string; sub: string; badge?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--mm-muted)]">{sub}</p>
      </div>
      {badge}
    </div>
  );
}

function NotInDemo({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <Badge tone="neutral">Not part of the demo</Badge>
      </div>
      <p className="mt-1 text-sm text-[var(--mm-muted)]">{body}</p>
    </Card>
  );
}

function Bar({ pct, tone = "accent" }: { pct: number; tone?: "accent" | "warn" | "danger" }) {
  const color = tone === "danger" ? "#dc2626" : tone === "warn" ? "#d97706" : "var(--mm-accent)";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--mm-border)]">
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

const LIVE_HINT = "Mock mode: no PayPal or Braintree call is made until server credentials are set.";

/* ------------------------------ Command Center ------------------------------ */

type Health = { score: number; grade: string; role: string; role_mode: string; client_ip_source?: string; checks: Array<{ id: string; label: string; passed: boolean; weight: number; detail: string }> };

export function CommandCenterScreen({ state, setPage, runScenario }: ScreenProps) {
  const health = useJson<Health>("/api/security/health");
  const h = health.data;
  const mock = state.modes.paypal === "mock" && (state.modes.payment ?? "mock") === "mock";
  const activeMandates = (state.mandates || []).filter((m) => m.status === "active").length;
  const settled = state.payments.filter((p) => ["captured", "settled"].includes(p.status)).length;
  const guard = guardAnalytics(state.events, state.paypal_tool_calls || []);
  const env = [
    { k: "Payments", v: state.modes.payment || state.modes.paypal, live: (state.modes.payment ?? "mock") !== "mock" },
    { k: "PayPal server SDK", v: state.modes.paypal, live: state.modes.paypal === "sandbox" },
    { k: "Agent toolkit", v: state.modes.agentToolkit || "mock", live: state.modes.agentToolkit === "live" },
    { k: "AI planner", v: state.modes.planner.planner === "ai" ? `AI · ${state.modes.planner.model || "model"}` : "offline (deterministic)", live: state.modes.planner.planner === "ai" },
    { k: "Role mode", v: h?.role_mode === "pin" ? "PIN + signed session" : h?.role_mode === "pin_misconfigured" ? "fail-closed (secret missing)" : "demo toggle", live: h?.role_mode === "pin" },
    { k: "Kill switch", v: state.settings.kill_switch ? "ON — agents frozen" : "off", live: !state.settings.kill_switch },
  ];
  return (
    <div className="space-y-4">
      <Header
        title="Command Center"
        sub="Live status of this deployment. The score below is computed by the server from real checks on every request. It is never hard-coded and can't reach 100 without real credentials and real RBAC."
        badge={<Badge tone={mock ? "warning" : "success"}>{mock ? "MOCK MODE — no real or sandbox money moves" : "Sandbox mode"}</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--mm-muted)]">Trust score (computed)</p>
          <p className="mt-2 text-6xl font-semibold tabular" data-testid="cc-score">{h ? h.score : "…"}<span className="text-xl text-[var(--mm-muted)]">/100</span></p>
          <Badge tone={h && h.score >= 75 ? "success" : "warning"}>{h ? `Grade ${h.grade}` : "loading"}</Badge>
          <p className="mt-2 text-xs text-[var(--mm-muted)]">{h ? `${h.checks.filter((c) => c.passed).length}/${h.checks.length} checks passing` : ""}</p>
          <Button className="mt-3" variant="secondary" onClick={() => setPage("security")}>Open Security Center</Button>
        </Card>
        <Card className="lg:col-span-2">
          <p className="text-xs uppercase tracking-wide text-[var(--mm-muted)]">Score breakdown</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {h?.checks.map((c) => (
              <li key={c.id} className="rounded-xl border border-[var(--mm-border)] p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.label}</span>
                  <Badge tone={c.passed ? "success" : "warning"}>{c.passed ? `+${c.weight}` : `0/${c.weight}`}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--mm-muted)]">Environment</p>
          <dl className="mt-2 space-y-1.5 text-sm">
            {env.map((e) => (
              <div key={e.k} className="flex items-center justify-between gap-2">
                <dt className="text-[var(--mm-muted)]">{e.k}</dt>
                <dd><Badge tone={e.live ? "success" : "warning"}>{e.v}</Badge></dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11px] text-[var(--mm-muted)]">{LIVE_HINT}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--mm-muted)]">Guard activity (this instance)</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-[var(--mm-muted)]">Active mandates</dt><dd className="text-2xl font-semibold tabular">{activeMandates}</dd></div>
            <div><dt className="text-[var(--mm-muted)]">Settled payments</dt><dd className="text-2xl font-semibold tabular">{settled}</dd></div>
            <div><dt className="text-[var(--mm-muted)]">DENY decisions</dt><dd className="text-2xl font-semibold tabular">{guard.policy_decisions.DENY}</dd></div>
            <div><dt className="text-[var(--mm-muted)]">Audit events</dt><dd className="text-2xl font-semibold tabular">{guard.audit_events}</dd></div>
          </dl>
          <p className="mt-2 text-[11px] text-[var(--mm-muted)]">Render&apos;s free disk is ephemeral, so counts reset when the instance restarts.</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--mm-muted)]">Demo scenarios (owner)</p>
          <div className="mt-2 flex flex-col gap-2">
            <Button variant="secondary" onClick={() => runScenario("buy-safely", "vault")}>A · $50 launch mandate</Button>
            <Button variant="secondary" onClick={() => runScenario("subscriptions", "subscriptions")}>B · $30/mo subscription guardian</Button>
            <Button variant="secondary" onClick={() => runScenario("malicious", "agents")}>C · Malicious merchant</Button>
            <Button variant="secondary" onClick={() => setPage("coach")}>₹65,000 laptop check</Button>
          </div>
          <p className="mt-2 text-[11px] text-[var(--mm-muted)]">Viewers get 403. Switch to owner in Security Center first.</p>
        </Card>
      </div>
      <Card>
        <p className="text-xs uppercase tracking-wide text-[var(--mm-muted)]">Open-source PayPal libraries in use</p>
        <ul className="mt-2 grid gap-2 md:grid-cols-2">
          {REPOS.map((r) => (
            <li key={r.name} className="rounded-xl border border-[var(--mm-border)] p-2 text-sm">
              <a className="font-medium underline-offset-2 hover:underline" href={r.url} target="_blank" rel="noreferrer">{r.name}</a>
              <p className="text-xs text-[var(--mm-muted)]">{r.pkg} · {r.license} · {r.use}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------ Money OS ------------------------------ */

const STAGES = ["proposed", "authorized", "captured", "refunded"] as const;
function stageIndex(p: Payment, refunded: boolean): number {
  if (refunded || p.status === "refunded") return 3;
  if (["captured", "settled"].includes(p.status)) return 2;
  if (p.status === "authorized") return 1;
  return 0;
}

export function MoneyOsScreen({ state, setPage }: ScreenProps) {
  const refunds = useJson<{ refunds: RefundRecord[] }>("/api/refunds");
  const mock = state.modes.paypal === "mock" && (state.modes.payment ?? "mock") === "mock";
  const refundedIds = new Set((refunds.data?.refunds || []).filter((r) => r.status === "COMPLETED").map((r) => r.payment_id));
  const subs = state.subscriptions || [];
  const catalog = state.merchants;
  return (
    <div className="space-y-4">
      <Header
        title="Money OS"
        sub="Every money flow AgentPaL runs, in one place. Each one goes through AgentPaL Guard (mandate, policy, reservation), is idempotent, and is audited. Anything without a backend is marked “Not part of the demo”."
        badge={<Badge tone={mock ? "warning" : "success"}>{mock ? "MOCK — no PayPal call" : "PayPal sandbox"}</Badge>}
      />
      <Card>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Order → Authorize → Capture → Refund</h3>
          <Button variant="ghost" onClick={() => setPage("refunds")}>Refunds →</Button>
        </div>
        <p className="mt-1 text-xs text-[var(--mm-muted)]">AUTHORIZE intent → Guard re-checks amount, payee, mandate and reservation → capture, or void on any mismatch. Refunds are capped at the captured amount and need a reason.</p>
        {state.payments.length === 0 ? (
          <div className="mt-3"><EmptyState title="No payments yet" body="Run scenario A from the Command Center (as owner) to create the lifecycle." /></div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-[var(--mm-muted)]">
                <tr><th className="py-1">Merchant</th><th>Amount</th><th>Rail</th>{STAGES.map((s) => <th key={s} className="capitalize">{s}</th>)}<th>Status</th></tr>
              </thead>
              <tbody>
                {state.payments.slice(-10).reverse().map((p) => {
                  const idx = stageIndex(p, refundedIds.has(p.payment_id));
                  const dead = ["denied", "failed", "voided"].includes(p.status);
                  return (
                    <tr key={p.payment_id} className="border-t border-[var(--mm-border)]">
                      <td className="py-1.5">{p.merchant_name}</td>
                      <td className="tabular">{formatMoney(p.amount, p.currency)}</td>
                      <td className="text-xs">{p.rail}</td>
                      {STAGES.map((s, i) => (
                        <td key={s}>{dead && i > 0 ? "—" : i <= idx ? "●" : "○"}</td>
                      ))}
                      <td><Badge tone={dead ? "danger" : idx >= 2 ? "success" : "warning"}>{p.status}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Invoices &amp; plans</h3><Button variant="ghost" onClick={() => setPage("invoices")}>Open →</Button></div>
          <p className="mt-1 text-sm text-[var(--mm-muted)]">Created and sent through the agent toolkit, owner role only. Invoices are capped at USD 500. Plans must stay within the $30/month guardian cap.</p>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Subscriptions</h3><Button variant="ghost" onClick={() => setPage("subscriptions")}>Open →</Button></div>
          <p className="mt-1 text-sm text-[var(--mm-muted)]">{subs.length ? `${subs.length} managed subscription(s), ${subs.filter((s) => s.status === "active").length} active. Total ${formatMoney(subs.filter((s) => s.status === "active").reduce((a, s) => a + s.amount, 0), "USD")}/month.` : "Run scenario B to create managed subscriptions."}</p>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Disputes</h3><Button variant="ghost" onClick={() => setPage("refunds")}>Open →</Button></div>
          <p className="mt-1 text-sm text-[var(--mm-muted)]">Listed from PayPal via the toolkit when live. In mock mode they are seeded examples labelled DEMO DATA.</p>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="font-semibold">Catalog (server-side prices)</h3>
          <p className="mt-1 text-xs text-[var(--mm-muted)]">Agents can only pick catalog SKUs, and the price always comes from here. Checkout runs through Guard from the Agents, Coach and Payment Links screens.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {catalog.slice(0, 6).map((m) => (
              <li key={m.merchant_id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--mm-border)] px-2 py-1">
                <span>{m.name}</span>
                {m.injection_bait ? <Badge tone="danger">untrusted text</Badge> : <Badge tone="neutral">{m.merchant_id}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h3 className="font-semibold">Pay Later messaging</h3>
          <p className="mt-1 text-xs text-[var(--mm-muted)]">Rendered by PayPal&apos;s own <code>messages</code> component (paypal-js) for a $49 domain bundle.</p>
          <div className="mt-3"><PayLaterMessage amountUsd={49} /></div>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <NotInDemo title="Payouts" body="Sending money out to third parties isn't wired. A real version would be owner-only, sandbox-only, Guard-capped and need step-up confirmation." />
        <NotInDemo title="Vault (saved payment methods)" body="AgentPaL never stores card data. Vaulting isn't wired. Braintree Drop-in and PayPal Buttons are used per payment instead." />
        <NotInDemo title="Shipment tracking" body="The toolkit has create/get shipment tracking tools. They're listed in the AI Agent Mesh as not enabled." />
      </div>
    </div>
  );
}

/* ------------------------------ AI Agent Mesh ------------------------------ */

type Mesh = {
  mode: "live" | "mock";
  catalogue_source: string;
  toolkit_version: string;
  counts: { total: number; coach_allowed: number; owner_only: number; not_enabled: number };
  library: Array<{ name: string; description: string; guard: "coach_allowed" | "owner_only" | "not_enabled"; kind?: string; guardrails: string[] }>;
  fleet: Array<{ id: string; name: string; role: string; planner: string; tools: string[]; can_create_mandates: boolean; can_choose_amounts: boolean; can_self_approve: boolean; can_capture: boolean; authority: string }>;
};

const GUARD_LABEL = { coach_allowed: "Coach allowlist", owner_only: "Owner API only", not_enabled: "Not enabled" } as const;
const GUARD_TONE = { coach_allowed: "success", owner_only: "info", not_enabled: "neutral" } as const;

export function AgentMeshScreen({ state, setPage }: ScreenProps) {
  const mesh = useJson<Mesh>("/api/agent-mesh");
  const m = mesh.data;
  const [filter, setFilter] = useState<"all" | keyof typeof GUARD_LABEL>("all");
  const lib = useMemo(() => (m?.library || []).filter((t) => filter === "all" || t.guard === filter), [m, filter]);
  const trace = (state.paypal_tool_calls || []).slice(-12).reverse();
  return (
    <div className="space-y-4">
      <Header
        title="AI Agent Mesh"
        sub="The PayPal agent toolkit's real tool catalogue, read from the installed package, mapped to the AgentPaL Guard policy for each tool. No agent can create a mandate, choose an amount, approve itself or capture money."
        badge={<Badge tone={m?.mode === "live" ? "success" : "warning"}>{m?.mode === "live" ? "Toolkit · sandbox" : "Toolkit · MOCK"}</Badge>}
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Tool library</h3>
            <p className="text-xs text-[var(--mm-muted)]">{m ? `${m.toolkit_version} · ${m.counts.total} tools (${m.catalogue_source === "toolkit" ? "read from the package" : "fallback list"}) · ${m.counts.coach_allowed} Coach · ${m.counts.owner_only} owner · ${m.counts.not_enabled} not enabled` : "Loading…"}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "coach_allowed", "owner_only", "not_enabled"] as const).map((f) => (
              <Button key={f} variant={filter === f ? "primary" : "secondary"} onClick={() => setFilter(f)}>{f === "all" ? "All" : GUARD_LABEL[f]}</Button>
            ))}
          </div>
        </div>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {lib.map((t) => (
            <li key={t.name} className="rounded-xl border border-[var(--mm-border)] p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-xs">{t.name}</code>
                <Badge tone={GUARD_TONE[t.guard]}>{GUARD_LABEL[t.guard]}</Badge>
              </div>
              {t.description && <p className="mt-1 text-xs text-[var(--mm-muted)]">{t.description}</p>}
              <ul className="mt-1 list-disc pl-4 text-[11px] text-[var(--mm-muted)]">
                {t.guardrails.slice(0, 3).map((g) => <li key={g}>{g}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-semibold">Agent fleet (declarative config)</h3>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {(m?.fleet || []).map((a) => (
            <div key={a.id} className="rounded-xl border border-[var(--mm-border)] p-3 text-sm">
              <p className="font-medium">{a.name}</p>
              <p className="text-xs text-[var(--mm-muted)]">{a.role}</p>
              <p className="mt-1 text-[11px] text-[var(--mm-muted)]">Planner: {a.planner} · Authority: {a.authority}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(["can_create_mandates", "can_choose_amounts", "can_self_approve", "can_capture"] as const).map((k) => (
                  <Badge key={k} tone={a[k] ? "danger" : "success"}>{k.replace(/_/g, " ")}: {a[k] ? "yes" : "no"}</Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Tool-call trace (from the audit log)</h3>
          <Button variant="ghost" onClick={() => setPage("coach")}>Run Guard demo in Coach →</Button>
        </div>
        {trace.length === 0 ? (
          <div className="mt-2"><EmptyState title="No toolkit calls yet" body="Sign the Coach tools mandate and run the Guard demo from the AI Coach screen (owner)." /></div>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {trace.map((c) => (
              <li key={c.call_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--mm-border)] px-2 py-1">
                <span className="font-mono">{c.tool}</span>
                <span className="text-[var(--mm-muted)]">{c.source} · {c.mode}</span>
                <Badge tone={c.decision === "EXECUTED" ? "success" : c.decision === "NEEDS_APPROVAL" ? "warning" : "danger"}>{c.decision}</Badge>
                <span className="font-mono text-[10px] text-[var(--mm-muted)]">receipt {c.receipt.receipt_id}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------ Hardening ------------------------------ */

type HardeningStatus = {
  role: string;
  role_mode: string;
  secrets: Array<{ key: string; configured: boolean }>;
  public_env_count: number;
  idempotency: Array<{ key: string; scope: string; status: number; request_hash: string; created_at: string }>;
  idempotency_total: number;
  audit_events: number;
};
type SimResult = { case: string; status: number; result: string; detail?: string; signed_message?: string; body_preview?: string };

const RBAC_MATRIX = [
  { action: "Read every screen and API (GET)", viewer: true, owner: true },
  { action: "Engage kill switch", viewer: true, owner: true },
  { action: "Release kill switch", viewer: false, owner: true },
  { action: "Sign mandates / accept trade-offs", viewer: false, owner: true },
  { action: "Run demo scenarios, refunds, invoices, plans", viewer: false, owner: true },
  { action: "Payments (authorize, capture via approval)", viewer: false, owner: true },
];

export function HardeningScreen({ run }: ScreenProps) {
  const status = useJson<HardeningStatus>("/api/hardening/status");
  const chain = useJson<{ ok: boolean; checked: number; detail: string }>("/api/audit/verify");
  const [sim, setSim] = useState<SimResult[]>([]);
  const fire = (c: string) =>
    run(`Simulating ${c} webhook…`, async () => {
      const r = await getJson<SimResult & { error?: string }>("/api/hardening/webhook-sim", { method: "POST", body: JSON.stringify({ case: c }) });
      if (!r.ok && r.status !== 409) throw new Error(r.body.error || `HTTP ${r.status}`);
      setSim((s) => [r.body, ...s].slice(0, 8));
    });
  const s = status.data;
  return (
    <div className="space-y-4">
      <Header title="Hardening" sub="The controls that keep agents honest, shown live: webhook verification, idempotency, RBAC, secrets status and the tamper-evident audit log." />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Webhook verification simulator</h3>
          <Badge tone="neutral">Local simulator · not PayPal</Badge>
        </div>
        <p className="mt-1 text-xs text-[var(--mm-muted)]">
          Runs the same intake code as <code>/api/webhooks/paypal</code>: required headers, a ±5-minute window, replay rejection and signature verification. It uses a scratch store and a locally generated RSA-2048 key in place of PayPal&apos;s certificate. The signed message has the same shape as PayPal&apos;s: <code>transmission_id|time|webhook_id|crc32(body)</code>.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => fire("valid")}>Send valid event</Button>
          <Button variant="secondary" onClick={() => fire("replay")}>Replay last event</Button>
          <Button variant="secondary" onClick={() => fire("tampered")}>Tamper amount after signing</Button>
          <Button variant="secondary" onClick={() => fire("stale")}>Send 10-min-old event</Button>
          <Button variant="ghost" onClick={() => fire("reset")}>Reset</Button>
        </div>
        <ul className="mt-3 space-y-1 text-xs" data-testid="webhook-sim-results">
          {sim.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--mm-border)] px-2 py-1">
              <span className="font-medium">{r.case}</span>
              <span className="font-mono">{r.result}</span>
              <Badge tone={r.status < 300 && r.result !== "duplicate_ignored" ? "success" : "danger"}>HTTP {r.status}</Badge>
              {r.detail && <span className="w-full text-[var(--mm-muted)]">{r.detail}</span>}
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="font-semibold">RBAC (enforced in middleware + routes)</h3>
          <p className="text-xs text-[var(--mm-muted)]">You are <b>{s?.role || "…"}</b> · mode {s?.role_mode === "pin" ? "PIN + signed session" : s?.role_mode === "pin_misconfigured" ? "fail-closed" : "demo toggle (no real access control; counted as failed in the score)"}</p>
          <table className="mt-2 w-full text-left text-xs">
            <thead className="text-[var(--mm-muted)]"><tr><th className="py-1">Action</th><th>Viewer (default)</th><th>Owner</th></tr></thead>
            <tbody>
              {RBAC_MATRIX.map((r) => (
                <tr key={r.action} className="border-t border-[var(--mm-border)]"><td className="py-1">{r.action}</td><td>{r.viewer ? "✓" : "403"}</td><td>{r.owner ? "✓" : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <h3 className="font-semibold">Secrets vault — status only</h3>
          <p className="text-xs text-[var(--mm-muted)]">Values never leave the server. {s ? `${s.public_env_count} NEXT_PUBLIC_* variables are exposed to the browser.` : ""}</p>
          <ul className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {(s?.secrets || []).map((x) => (
              <li key={x.key} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--mm-border)] px-2 py-1">
                <code>{x.key}</code>
                <Badge tone={x.configured ? "success" : "warning"}>{x.configured ? "configured" : "not set"}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="font-semibold">Idempotency store</h3>
          <p className="text-xs text-[var(--mm-muted)]">Retrying with the same <code>Idempotency-Key</code> replays the stored response. Reusing a key with a different body gets 409. {s ? `${s.idempotency_total} stored response(s).` : ""}</p>
          {s && s.idempotency.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--mm-muted)]">None yet. Refunds, authorizations and plan creation store their responses here.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-[11px]">
              {(s?.idempotency || []).map((r) => (
                <li key={r.key + r.created_at} className="flex flex-wrap justify-between gap-2 rounded-lg border border-[var(--mm-border)] px-2 py-1 font-mono">
                  <span>{r.scope}</span><span>{r.key}</span><span>HTTP {r.status}</span><span>#{r.request_hash}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h3 className="font-semibold">Audit log</h3>
          <p className="mt-1 text-2xl font-semibold">{chain.data ? (chain.data.ok ? "Chain intact" : "CHAIN BROKEN") : "…"}</p>
          <p className="text-xs text-[var(--mm-muted)]">{chain.data?.detail}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => run("Verifying audit chain…", chain.reload)}>Re-verify SHA-256 chain</Button>
            <Button variant="secondary" href="/api/audit/export">Export CSV</Button>
          </div>
        </Card>
      </div>
      <Card>
        <h3 className="font-semibold">Code that enforces this</h3>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          {SNIPPETS.slice(0, 4).map((sn) => (
            <div key={sn.title}>
              <p className="text-xs font-medium">{sn.title} <span className="text-[var(--mm-muted)]">· {sn.file}</span></p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-[var(--mm-bg)] p-2 text-[11px] leading-snug"><code>{sn.code}</code></pre>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------ Analytics ------------------------------ */

export function AnalyticsScreen({ state }: ScreenProps) {
  const fin = useMemo(() => financeAnalytics(state.finance), [state.finance]);
  const guard = useMemo(() => guardAnalytics(state.events, state.paypal_tool_calls || []), [state.events, state.paypal_tool_calls]);
  const maxFlow = Math.max(1, ...fin.months.map((m) => Math.max(m.income, m.expenses)));
  const maxCat = Math.max(1, ...fin.categories.map((c) => c.amount));
  return (
    <div className="space-y-4">
      <Header
        title="Analytics"
        sub={`Computed live from the seeded INR demo data (as of ${fin.as_of ? new Date(fin.as_of).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" }) : "seed date"}) and this instance's audit log. It is demo data, not a real bank or PayPal account.`}
        badge={<Badge tone="warning">Seeded demo data</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="font-semibold">Monthly cash flow (INR)</h3>
          <ul className="mt-3 space-y-3 text-xs">
            {fin.months.map((m) => (
              <li key={m.month}>
                <div className="flex justify-between"><span className="font-medium">{m.month}</span><span className="tabular">net {formatINR(m.net)}</span></div>
                <div className="mt-1 flex items-center gap-2"><span className="w-16 text-[var(--mm-muted)]">income</span><Bar pct={(m.income / maxFlow) * 100} /><span className="w-24 text-right tabular">{formatINR(m.income)}</span></div>
                <div className="mt-1 flex items-center gap-2"><span className="w-16 text-[var(--mm-muted)]">expenses</span><Bar pct={(m.expenses / maxFlow) * 100} tone="warn" /><span className="w-24 text-right tabular">{formatINR(m.expenses)}</span></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h3 className="font-semibold">Spending by category · {fin.latest_month}</h3>
          <ul className="mt-3 space-y-2 text-xs">
            {fin.categories.map((c) => (
              <li key={c.category} className="flex items-center gap-2"><span className="w-28 truncate">{c.category}</span><Bar pct={(c.amount / maxCat) * 100} /><span className="w-24 text-right tabular">{formatINR(c.amount)}</span></li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="font-semibold">Budget utilisation</h3>
          <ul className="mt-3 space-y-2 text-xs">
            {fin.budgets.map((b) => (
              <li key={b.category}>
                <div className="flex justify-between"><span>{b.category}</span><span className="tabular">{b.pct}%</span></div>
                <Bar pct={b.pct} tone={b.pct > 100 ? "danger" : b.pct > 80 ? "warn" : "accent"} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h3 className="font-semibold">Savings goals</h3>
          <ul className="mt-3 space-y-2 text-xs">
            {fin.goals.map((g) => (
              <li key={g.name}>
                <div className="flex justify-between"><span>{g.name}</span><span className="tabular">{formatINR(g.current)} / {formatINR(g.target)}</span></div>
                <Bar pct={g.pct} />
              </li>
            ))}
          </ul>
          <h4 className="mt-4 text-xs font-semibold">Top merchants · {fin.latest_month}</h4>
          <ul className="mt-1 space-y-0.5 text-xs">
            {fin.merchants.map((m) => <li key={m.merchant} className="flex justify-between"><span>{m.merchant}</span><span className="tabular">{formatINR(m.amount)}</span></li>)}
          </ul>
        </Card>
        <Card>
          <h3 className="font-semibold">Guard outcomes (this instance)</h3>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            {(["ALLOW", "REQUIRE_APPROVAL", "DENY"] as const).map((d) => (
              <div key={d} className="rounded-xl border border-[var(--mm-border)] p-2">
                <dt className="text-[10px] text-[var(--mm-muted)]">{d.replace("_", " ")}</dt>
                <dd className="text-2xl font-semibold tabular">{guard.policy_decisions[d]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-[var(--mm-muted)]">Toolkit calls: {Object.entries(guard.tool_calls).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"}</p>
          <p className="mt-1 text-xs text-[var(--mm-muted)]">Protective events (blocked, denied, kill switch, no mandate): {guard.protective_events}</p>
        </Card>
      </div>
    </div>
  );
}
