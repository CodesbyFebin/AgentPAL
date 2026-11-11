"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState } from "@/components/ui/kit";
import type { ScreenProps } from "@/components/screens/Screens";
import type { PayPalToolCall, RefundRecord } from "@/lib/types";

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, body };
}

function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const r = await api<T & { error?: string }>(path);
    if (!r.ok) setError((r.body as { error?: string }).error || `HTTP ${r.status}`);
    else {
      setError(null);
      setData(r.body);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}

function idemKey() {
  return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ModeBadge({ mock }: { mock: boolean }) {
  return <Badge tone={mock ? "warning" : "success"}>{mock ? "MOCK — no PayPal call" : "PayPal sandbox"}</Badge>;
}

function DecisionBadge({ d }: { d: string }) {
  const tone = d === "EXECUTED" || d === "COMPLETED" ? "success" : d === "NEEDS_APPROVAL" ? "warning" : "danger";
  return <Badge tone={tone}>{d === "BLOCKED" ? "BLOCKED by Guard" : d}</Badge>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg)] px-3 py-2 text-sm ${props.className || ""}`} />;
}

function ResultNote({ call }: { call: PayPalToolCall | null }) {
  if (!call) return null;
  return (
    <div className="mt-3 rounded-xl border border-[var(--mm-border)] p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono">{call.tool}</span>
        <DecisionBadge d={call.decision} />
      </div>
      <p className="mt-1 text-[var(--mm-muted)]">{call.reason}</p>
      <p className="mt-1 text-[10px] text-[var(--mm-muted)]">receipt {call.receipt.receipt_id} · audit {call.receipt.event_hash.slice(0, 10)}…</p>
    </div>
  );
}

/* ------------------------------ Refunds & Disputes ------------------------------ */

type RefundsData = {
  refunds: RefundRecord[];
  refundable: Array<{ payment_id: string; merchant_name: string; status: string; rail?: string; mode: string; settled_usd: number; refunded_usd: number; refundable_usd: number }>;
};

export function RefundsScreen({ state, run }: ScreenProps) {
  const refunds = useApi<RefundsData>("/api/refunds");
  const disputes = useApi<{ call: PayPalToolCall }>("/api/disputes");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [last, setLast] = useState<RefundRecord | null>(null);
  const items = ((disputes.data?.call.result as { items?: Array<Record<string, unknown>> } | undefined)?.items || []) as Array<Record<string, unknown>>;
  const disputesMock = disputes.data?.call.mode === "mock";

  const refund = (paymentId: string) =>
    run("Requesting refund through AgentPaL Guard…", async () => {
      const raw = amounts[paymentId];
      const r = await api<{ refund?: RefundRecord; error?: string }>("/api/refunds", {
        method: "POST",
        headers: { "Idempotency-Key": idemKey() },
        body: JSON.stringify({ payment_id: paymentId, amount: raw ? Number(raw) : undefined, reason: reasons[paymentId] || "" }),
      });
      if (r.body.refund) setLast(r.body.refund);
      await refunds.reload();
      if (!r.ok && !r.body.refund) throw new Error(r.body.error || "refund failed");
    });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Refunds &amp; Disputes</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--mm-muted)]">
          Full or partial refunds of captured payments go through AgentPaL Guard. Each one needs a reason, is capped at the
          captured amount minus earlier refunds, is blocked while the kill switch is on, and is idempotent: the
          Idempotency-Key header is forwarded to PayPal as PayPal-Request-Id. Every outcome is written to the audit log.
          {state.settings.kill_switch && " Kill switch is ON, so refunds are currently blocked."}
        </p>
      </div>
      {last && (
        <Card>
          <div className="flex items-center justify-between"><span className="text-sm font-medium">Last refund · USD {last.amount.toFixed(2)} ({last.kind})</span><DecisionBadge d={last.status} /></div>
          <p className="mt-1 text-xs text-[var(--mm-muted)]">{last.block_reason || `${last.mode === "mock" ? "MOCK refund — no processor call" : `${last.provider} sandbox refund ${last.provider_refund_id}`} · PayPal-Request-Id ${last.paypal_request_id}`}</p>
        </Card>
      )}
      <Card>
        <h3 className="font-semibold">Captured payments</h3>
        {!refunds.data?.refundable.length && <div className="mt-3"><EmptyState title="Nothing captured yet" body="Run scenario A and pay it on Payment Methods, then refund it here." /></div>}
        <ul className="mt-3 space-y-3">
          {refunds.data?.refundable.map((p) => (
            <li key={p.payment_id} className="rounded-xl border border-[var(--mm-border)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{p.merchant_name}</span>
                <span className="text-xs text-[var(--mm-muted)]">settled USD {p.settled_usd.toFixed(2)} · refunded USD {p.refunded_usd.toFixed(2)} · refundable USD {p.refundable_usd.toFixed(2)}</span>
                <Badge tone={p.mode === "mock" ? "warning" : "success"}>{p.mode === "mock" ? "MOCK payment" : `${p.rail} · sandbox`}</Badge>
              </div>
              {p.refundable_usd > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Input placeholder={`Amount (max ${p.refundable_usd.toFixed(2)}, blank = full)`} value={amounts[p.payment_id] || ""} onChange={(e) => setAmounts({ ...amounts, [p.payment_id]: e.target.value })} />
                  <Input placeholder="Reason (required)" value={reasons[p.payment_id] || ""} onChange={(e) => setReasons({ ...reasons, [p.payment_id]: e.target.value })} />
                  <Button variant="danger" onClick={() => refund(p.payment_id)}>Refund via Guard</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-semibold">Refund history</h3>
        <ul className="mt-2 space-y-1 text-xs">
          {(refunds.data?.refunds || []).slice(0, 12).map((r) => (
            <li key={r.refund_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--mm-border)] py-1">
              <span>{r.created_at.slice(0, 19).replace("T", " ")} · {r.payment_id} · USD {r.amount.toFixed(2)} · {r.reason || "—"}</span>
              <span className="flex items-center gap-2">{r.mode === "mock" && r.status === "COMPLETED" && <Badge tone="warning">MOCK</Badge>}<DecisionBadge d={r.status} /></span>
            </li>
          ))}
          {!refunds.data?.refunds.length && <li className="text-[var(--mm-muted)]">No refunds yet.</li>}
        </ul>
      </Card>
      <Card>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Disputes (agent toolkit · list_disputes)</h3>
          {disputes.data && <ModeBadge mock={disputesMock} />}
        </div>
        {disputesMock && <p className="mt-1 text-xs text-amber-700">DEMO DATA. These disputes are seeded examples shown because PayPal credentials are not set. They do not come from PayPal.</p>}
        {disputes.data?.call.decision !== "EXECUTED" && disputes.data && <ResultNote call={disputes.data.call} />}
        <ul className="mt-3 space-y-2 text-sm">
          {items.map((d) => (
            <li key={String(d.dispute_id)} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--mm-border)] p-2">
              <span className="font-mono text-xs">{String(d.dispute_id)}</span>
              <span className="text-xs">{String(d.reason)}</span>
              <span className="text-xs">{(d.dispute_amount as { value?: string })?.value ? `USD ${(d.dispute_amount as { value: string }).value}` : ""}</span>
              <Badge tone={d.status === "RESOLVED" ? "success" : "warning"}>{String(d.status)}{d.demo ? " · DEMO" : ""}</Badge>
            </li>
          ))}
          {disputes.data?.call.decision === "EXECUTED" && !items.length && <li className="text-xs text-[var(--mm-muted)]">No disputes returned.</li>}
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------ Invoices & Plans ------------------------------ */

export function InvoicesScreen({ state, run }: ScreenProps) {
  const invoices = useApi<{ call: PayPalToolCall }>("/api/invoices");
  const plans = useApi<{ call: PayPalToolCall }>("/api/paypal-plans");
  const [email, setEmail] = useState("demo-buyer@example.com");
  const [item, setItem] = useState("Design consultation (demo)");
  const [amount, setAmount] = useState("120");
  const [planName, setPlanName] = useState("AgentPaL Pro (demo)");
  const [planPrice, setPlanPrice] = useState("9.99");
  const [subId, setSubId] = useState("I-BW452GLLEP1G");
  const [subReason, setSubReason] = useState("Over the subscription guardian budget");
  const [last, setLast] = useState<PayPalToolCall | null>(null);
  const invList = ((invoices.data?.call.result as { items?: Array<Record<string, unknown>> } | undefined)?.items || []) as Array<Record<string, unknown>>;
  const planList = ((plans.data?.call.result as { plans?: Array<Record<string, unknown>> } | undefined)?.plans || []) as Array<Record<string, unknown>>;
  const mock = (state.modes.agentToolkit || "mock") === "mock";

  const post = (label: string, path: string, body: unknown, after: () => Promise<void>) =>
    run(label, async () => {
      const r = await api<{ call?: PayPalToolCall; plan?: PayPalToolCall; product?: PayPalToolCall; error?: string }>(path, {
        method: "POST",
        headers: { "Idempotency-Key": idemKey() },
        body: JSON.stringify(body),
      });
      setLast(r.body.call || r.body.plan || r.body.product || null);
      await after();
      if (!r.body.call && !r.body.plan && !r.body.product && !r.ok) throw new Error(r.body.error || "request failed");
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Invoices &amp; Subscription Plans</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--mm-muted)]">
            Built with PayPal&apos;s agent toolkit. Every create, send or cancel passes AgentPaL Guard first: owner role, kill
            switch, a USD 500 invoice cap, and the Scenario B subscription guardian cap of USD 30/month for new plans.
            Each call is audited and gets a signed receipt.
          </p>
        </div>
        <ModeBadge mock={mock} />
      </div>
      <ResultNote call={last} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="font-semibold">Draft an invoice</h3>
          <div className="mt-3 grid gap-2">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Recipient email" />
            <Input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Item" />
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="USD amount" />
            <Button onClick={() => post("Drafting invoice through Guard…", "/api/invoices", { recipient_email: email, item_name: item, amount: Number(amount) }, invoices.reload)}>Create draft invoice</Button>
          </div>
          <h4 className="mt-4 text-sm font-semibold">Invoices {invoices.data && <span className="ml-1"><ModeBadge mock={invoices.data.call.mode === "mock"} /></span>}</h4>
          <ul className="mt-2 space-y-2 text-xs">
            {invList.map((inv) => {
              const idv = String(inv.id);
              const status = String(inv.status || (inv as { detail?: { status?: string } }).detail?.status || "");
              return (
                <li key={idv} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--mm-border)] p-2">
                  <span className="font-mono">{idv}</span>
                  <span>{inv.amount ? `USD ${String(inv.amount)}` : ""} {inv.recipient ? `→ ${String(inv.recipient)}` : ""}</span>
                  <Badge tone={inv.mock ? "warning" : "info"}>{status}</Badge>
                  {/DRAFT/.test(status) && (
                    <Button variant="secondary" onClick={() => post("Sending invoice through Guard…", `/api/invoices/${encodeURIComponent(idv)}/send`, {}, invoices.reload)}>Send</Button>
                  )}
                </li>
              );
            })}
            {!invList.length && <li className="text-[var(--mm-muted)]">No invoices yet.</li>}
          </ul>
        </Card>
        <Card>
          <h3 className="font-semibold">Subscription plans · Scenario B guardian</h3>
          <p className="mt-1 text-xs text-[var(--mm-muted)]">New plans must stay within USD 30/month. Anything above that needs human approval and is never sent to PayPal.</p>
          <div className="mt-3 grid gap-2">
            <Input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Plan name" />
            <Input value={planPrice} onChange={(e) => setPlanPrice(e.target.value)} placeholder="USD per month" />
            <Button onClick={() => post("Creating product + plan through Guard…", "/api/paypal-plans", { name: planName, monthly_usd: Number(planPrice) }, plans.reload)}>Create monthly plan</Button>
          </div>
          <h4 className="mt-4 text-sm font-semibold">Plans {plans.data && <span className="ml-1"><ModeBadge mock={plans.data.call.mode === "mock"} /></span>}</h4>
          <ul className="mt-2 space-y-2 text-xs">
            {planList.map((p) => (
              <li key={String(p.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--mm-border)] p-2">
                <span className="font-mono">{String(p.id)}</span>
                <span>{String(p.name || "")} {p.amount ? `· USD ${String(p.amount)}/mo` : ""}</span>
                <Badge tone={p.mock ? "warning" : "info"}>{String(p.status || "")}</Badge>
              </li>
            ))}
            {!planList.length && <li className="text-[var(--mm-muted)]">No plans yet.</li>}
          </ul>
          <h4 className="mt-4 text-sm font-semibold">Cancel a PayPal subscription</h4>
          <div className="mt-2 grid gap-2">
            <Input value={subId} onChange={(e) => setSubId(e.target.value)} placeholder="Subscription id (I-...)" />
            <Input value={subReason} onChange={(e) => setSubReason(e.target.value)} placeholder="Reason (required)" />
            <Button variant="danger" onClick={() => post("Cancelling through Guard…", `/api/paypal-subscriptions/${encodeURIComponent(subId)}/cancel`, { reason: subReason }, async () => undefined)}>Cancel subscription</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------ Security Center ------------------------------ */

type HealthData = { score: number; grade: string; role: "owner" | "viewer"; checks: Array<{ id: string; label: string; passed: boolean; weight: number; detail: string }> };

export function SecurityScreen({ run }: ScreenProps) {
  const health = useApi<HealthData>("/api/security/health");
  const chain = useApi<{ ok: boolean; checked: number; detail: string }>("/api/audit/verify");
  const setRole = (role: "owner" | "viewer") =>
    run(`Switching to ${role}…`, async () => {
      await api("/api/security/role", { method: "POST", body: JSON.stringify({ role }) });
      await health.reload();
    });
  const h = health.data;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Security Center</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--mm-muted)]">The health score is computed live on the server from real checks. Nothing here is hardcoded.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--mm-muted)]">Security health</p>
          <p className="mt-2 text-5xl font-semibold tabular">{h ? h.score : "…"}<span className="text-xl text-[var(--mm-muted)]">/100</span></p>
          <Badge tone={h && h.score >= 75 ? "success" : "warning"}>{h ? `Grade ${h.grade}` : "loading"}</Badge>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--mm-muted)]">Role (RBAC, enforced server-side)</p>
          <p className="mt-2 text-2xl font-semibold capitalize">{h?.role || "…"}</p>
          <p className="mt-1 text-xs text-[var(--mm-muted)]">A viewer can read everything and engage the kill switch. Every other POST returns 403 from middleware.</p>
          <div className="mt-2 flex gap-2">
            <Button variant={h?.role === "owner" ? "primary" : "secondary"} onClick={() => setRole("owner")}>Owner</Button>
            <Button variant={h?.role === "viewer" ? "primary" : "secondary"} onClick={() => setRole("viewer")}>Viewer</Button>
          </div>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--mm-muted)]">Audit chain</p>
          <p className="mt-2 text-2xl font-semibold">{chain.data ? (chain.data.ok ? "Intact" : "BROKEN") : "…"}</p>
          <p className="mt-1 text-xs text-[var(--mm-muted)]">{chain.data?.detail}</p>
          <Button className="mt-2" variant="secondary" onClick={() => run("Verifying audit chain…", chain.reload)}>Re-verify</Button>
        </Card>
      </div>
      <Card>
        <h3 className="font-semibold">Checks</h3>
        <ul className="mt-3 space-y-2">
          {h?.checks.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-[var(--mm-border)] p-2 text-sm">
              <div>
                <p className="font-medium">{c.label}</p>
                <p className="text-xs text-[var(--mm-muted)]">{c.detail}</p>
              </div>
              <Badge tone={c.passed ? "success" : "warning"}>{c.passed ? `pass · ${c.weight}` : `open · 0/${c.weight}`}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-semibold">Controls in place</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--mm-muted)]">
          <li><code>POST /api/webhooks/paypal</code> verifies each event with PayPal&apos;s verify-webhook-signature API (needs <code>PAYPAL_WEBHOOK_ID</code>), rejects events older than 5 minutes, and ignores replayed transmission IDs.</li>
          <li>Mutating payment, refund, invoice and plan routes accept <code>Idempotency-Key</code>. A retry gets the stored response back; reusing a key for a different request returns 409.</li>
          <li>Payment routes allow 20 requests per minute per client, and toolkit routes allow 30. Over the limit, they return 429.</li>
          <li>CSP, X-Frame-Options DENY, nosniff, HSTS, Referrer-Policy and Permissions-Policy are set on every response.</li>
          <li>Secrets stay server-side only. The PayPal client ID is public by design and served from <code>/api/paypal/config</code>. There are no <code>NEXT_PUBLIC_*</code> secrets.</li>
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------ Developer ------------------------------ */

const REPOS = [
  { name: "paypal/PayPal-TypeScript-Server-SDK", pkg: "@paypal/paypal-server-sdk@2.5.0", license: "MIT (npm metadata)", url: "https://github.com/paypal/PayPal-TypeScript-Server-SDK", use: "Orders, Payments, Subscriptions controllers" },
  { name: "paypal/agent-toolkit", pkg: "@paypal/agent-toolkit@1.11.0", license: "ISC (npm) / Apache-2.0 (repo)", url: "https://github.com/paypal/agent-toolkit", use: "AI SDK tools wrapped by AgentPaL Guard" },
  { name: "paypal/paypal-js", pkg: "@paypal/react-paypal-js@10.6.1", license: "Apache-2.0", url: "https://github.com/paypal/paypal-js", use: "Official PayPal Buttons on checkout" },
  { name: "braintree/braintree_node", pkg: "braintree@3.41.0", license: "MIT", url: "https://github.com/braintree/braintree_node", use: "Drop-in authorize → settle / void" },
];

const SNIPPETS: Array<{ title: string; file: string; code: string }> = [
  {
    title: "Authorize-only order with the server SDK",
    file: "src/lib/paypal.ts",
    code: `const { result } = await sdk().orders.createOrder({
  paypalRequestId: opts.requestId || opts.customId,
  prefer: "return=representation",
  body: {
    intent: CheckoutPaymentIntent.Authorize,
    purchaseUnits: [{ customId: opts.customId,
      amount: { currencyCode: "USD", value: opts.amount.toFixed(2) } }],
  },
});`,
  },
  {
    title: "Guard verifies what PayPal actually authorized, else void",
    file: "src/lib/engine.ts",
    code: `const binding = bindingMismatch(auth, payment.payment_id);
if (binding || !amountsMatch(auth.amount, expectedAmount, auth.currency, "USD")) {
  await voidReservedPayment(auth.authorization_id, payment.rail);
  throw new Error("Authorization does not match the reserved payment");
}
await captureReservedPayment(auth.authorization_id, payment.rail,
  { amount: expectedAmount, currency: "USD", requestId: \`cap-\${payment.payment_id}\` });`,
  },
  {
    title: "Every agent-toolkit call is wrapped",
    file: "src/lib/paypal-agent-tools.ts",
    code: `// allowlist → kill switch → mandate policy + catalog price → reservation
if (decision === "EXECUTED") {
  const tool = (await underlyingTools())[req.tool];   // @paypal/agent-toolkit/ai-sdk
  result = await tool.execute(args, { toolCallId: call_id, messages: [] });
}
const event = appendEvent(store, eventType, ...);        // hash-chained audit
receipt.signature = signPayload(unsigned, privateKeyPem); // Ed25519`,
  },
  {
    title: "Official PayPal Buttons call our Guarded routes",
    file: "src/components/PayPalButtonsCheckout.tsx",
    code: `<PayPalScriptProvider options={{ clientId: config.clientId, intent: "authorize" }}>
  <PayPalButtons
    createOrder={async () => (await post("/api/paypal/orders", { payment_id })).order_id}
    onApprove={async (d) => post(\`/api/payments/\${paymentId}/authorize\`, { order_id: d.orderID })}
  />
</PayPalScriptProvider>`,
  },
];

export function DeveloperScreen({ run }: ScreenProps) {
  const chain = useApi<{ ok: boolean; checked: number; detail: string }>("/api/audit/verify");
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Developer</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--mm-muted)]">Built with PayPal APIs. AgentPaL is an independent hackathon project, not a PayPal product, and is not endorsed by PayPal.</p>
      </div>
      <Card>
        <h3 className="font-semibold">Open-source libraries we use</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {REPOS.map((r) => (
            <li key={r.name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--mm-border)] p-2">
              <a className="font-medium underline" href={r.url} target="_blank" rel="noreferrer">{r.name}</a>
              <span className="font-mono text-xs">{r.pkg}</span>
              <span className="text-xs text-[var(--mm-muted)]">{r.use}</span>
              <Badge tone="info">{r.license}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Audit log</h3>
          <div className="flex gap-2">
            <Button variant="secondary" href="/api/audit/export">Export CSV</Button>
            <Button onClick={() => run("Verifying audit chain…", chain.reload)}>Verify chain</Button>
          </div>
        </div>
        <p className="mt-2 text-sm">{chain.data ? <Badge tone={chain.data.ok ? "success" : "danger"}>{chain.data.ok ? "Chain intact" : "Chain BROKEN"}</Badge> : "…"} <span className="ml-2 text-xs text-[var(--mm-muted)]">{chain.data?.detail}</span></p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {SNIPPETS.map((s) => (
          <Card key={s.title}>
            <h3 className="text-sm font-semibold">{s.title}</h3>
            <p className="font-mono text-[11px] text-[var(--mm-muted)]">{s.file}</p>
            <pre className="mt-2 overflow-auto rounded-xl bg-[#0b1020] p-3 text-[11px] leading-relaxed text-slate-100">{s.code}</pre>
          </Card>
        ))}
      </div>
    </div>
  );
}
