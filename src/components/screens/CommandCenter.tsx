"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Bot, CircleCheck, CircleMinus, Code2, Fingerprint, Gauge, ShieldCheck, ShoppingCart, Wallet } from "lucide-react";
import type { PageId, Snapshot } from "@/components/app-types";
import { Button, Card } from "@/components/ui/kit";
import type { HealthCheck } from "@/lib/security-health";
import type { Merchant } from "@/lib/types";

type CommandData = {
  score: number;
  grade: string;
  checks: HealthCheck[];
  fleet: { name: string; job: string; type: string }[];
  tools: { name: string; description: string; permission: string }[];
  metrics: Record<string, number>;
  secrets: { name: string; configured: boolean }[];
  ownerSessionRequired: boolean;
  payoutConfigured: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function post(body: unknown, key?: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify(body),
  };
}

const areas: { name: string; description: string; page: PageId; icon: typeof Wallet }[] = [
  { name: "Money OS", description: "Orders, capture, refunds, catalog, cart, and sandbox lookups", page: "money-os", icon: Wallet },
  { name: "AI Agent Mesh", description: "Fleet, Guard decisions, and the PayPal tool library", page: "agent-mesh", icon: Bot },
  { name: "Hardening", description: "Owner access, webhook simulator, idempotency, and audit", page: "hardening", icon: ShieldCheck },
  { name: "Analytics", description: "Payment outcomes and agent activity from this workspace", page: "analytics", icon: Gauge },
];

type Area = "command" | "money-os" | "agent-mesh" | "hardening" | "analytics";

export function CommandCenter({ area, state, setPage, refresh }: { area: Area; state: Snapshot; setPage: (page: PageId) => void; refresh: () => Promise<void> }) {
  const [data, setData] = useState<CommandData>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [mcpTools, setMcpTools] = useState<CommandData["tools"]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [mcpStatus, setMcpStatus] = useState("");

  useEffect(() => {
    let active = true;
    request<CommandData>("/api/command-center").then((result) => {
      if (active) {
        setData(result);
        setError("");
      }
    }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [area, state]);

  if (area === "money-os") return <MoneyOS state={state} setPage={setPage} payoutConfigured={data?.payoutConfigured ?? false} refresh={refresh} />;

  return (
    <div className="grid gap-5">
      <div className="rounded-3xl border border-[var(--mm-border)] px-6 py-8 sm:px-9" style={{ background: "linear-gradient(120deg, var(--mm-sidebar, #10142a), #28194b 78%, #482452)", color: "white" }}>
        <p className="text-xs font-semibold uppercase tracking-[.2em] text-white/70">PayPal AI Hackathon project</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">{area === "command" ? "AgentPaL Command Center" : areas.find((item) => item.page === area)?.name}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80">
          {area === "command" ? "Run your Money OS, review agent decisions, and verify checkout controls from one workspace." : areas.find((item) => item.page === area)?.description}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button href="/studio"><Bot size={16} /> Open AgentPaL Studio</Button>
          <Button variant="secondary" onClick={() => setPage(area === "command" ? "dashboard" : "command")}>{area === "command" ? "Finance dashboard" : "Command Center"}</Button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {area === "command" && <>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{areas.map(({ name, description, page, icon: Icon }) => (
          <button key={page} onClick={() => setPage(page)} className="mm-focus rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-surface)] p-5 text-left">
            <div className="flex justify-between"><Icon size={21} className="text-[var(--mm-accent)]" /><ArrowUpRight size={17} /></div>
            <h2 className="mt-4 font-semibold">{name}</h2>
            <p className="mt-1 text-sm text-[var(--mm-muted)]">{description}</p>
          </button>
        ))}</div>
        <Scoreboard data={data} />
      </>}
      {area === "agent-mesh" && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{data?.fleet.map((agent) => <Card key={agent.name} className="p-4">
          <p className="text-xs text-[var(--mm-muted)]">{agent.type}</p>
          <h2 className="mt-2 font-semibold">{agent.name}</h2>
          <p className="mt-1 text-sm">{agent.job}</p>
        </Card>)}</div>
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">PayPal tool library</h2>
              <p className="mt-1 text-sm text-[var(--mm-muted)]">{data?.tools.length ?? "…"} definitions from the installed Agent Toolkit. AgentPaL Guard controls executable actions.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setPage("coach")} variant="secondary">Open guarded console</Button>
              <Button disabled={discovering} onClick={async () => {
                setDiscovering(true);
                setMcpStatus("");
                try {
                  const result = await request<{ tools: CommandData["tools"]; truncated: boolean }>("/api/paypal-workbench/mcp", post({}));
                  setMcpTools(result.tools);
                  setMcpStatus(`${result.tools.length} sandbox MCP tools discovered${result.truncated ? " (partial list)" : ""}.`);
                } catch (err) {
                  setMcpStatus(err instanceof Error ? err.message : "Discovery failed.");
                } finally { setDiscovering(false); }
              }}>{discovering ? "Discovering…" : "Discover sandbox MCP"}</Button>
            </div>
          </div>
          {mcpStatus && <p role="status" className="mt-3 text-sm">{mcpStatus}</p>}
          <label className="mt-4 grid gap-1 text-sm">
            Filter tools
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="rounded-lg border border-[var(--mm-border)] bg-transparent p-2" placeholder="Order, invoice, tracking…" />
          </label>
          <ul className="mt-3 max-h-96 divide-y divide-[var(--mm-border)] overflow-auto">
            {[...(data?.tools ?? []), ...mcpTools].filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase())).map((tool) => (
              <li key={tool.permission + tool.name} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0"><code className="break-words text-sm">{tool.name}</code><p className="mt-1 text-xs text-[var(--mm-muted)]">{tool.description}</p></div>
                <span className="shrink-0 text-xs text-[var(--mm-muted)]">{tool.permission}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm"><a className="underline" href="https://github.com/paypal/paypal-mcp-server">PayPal MCP setup</a> · <a className="underline" href="https://github.com/paypal/agent-toolkit">PayPal Agent Toolkit source</a></p>
        </Card>
      </>}
      {area === "hardening" && <>
        <Scoreboard data={data} />
        <div className="grid gap-4 lg:grid-cols-2">
          <WebhookSimulator />
          <Card className="p-5">
            <Fingerprint size={20} />
            <h2 className="mt-2 text-lg font-semibold">Server secrets inventory</h2>
            <p className="mt-1 text-sm text-[var(--mm-muted)]">Configuration status from the server environment. Secret values stay server-side.</p>
            <ul className="mt-3 divide-y divide-[var(--mm-border)]">{data?.secrets.map((secret) => <li key={secret.name} className="flex flex-wrap justify-between gap-2 py-2 text-xs"><code>{secret.name}</code><span>{secret.configured ? "Configured" : "Missing"}</span></li>)}</ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setPage("security")}>Roles and audit</Button>
              <Button variant="secondary" onClick={() => setPage("developer")}>Code snippets</Button>
              {data?.ownerSessionRequired && <Button variant="ghost" onClick={async () => { await fetch("/api/security/session", { method: "DELETE" }); window.location.assign("/"); }}>Sign out</Button>}
            </div>
          </Card>
        </div>
      </>}
      {area === "analytics" && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(data?.metrics ?? {}).map(([name, value]) => (
            <Card key={name} className="p-4">
              <p className="text-sm capitalize text-[var(--mm-muted)]">{name.replace(/([A-Z])/g, " $1")}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
            </Card>
          ))}
        </div>
        <Card className="p-5">
          <h2 className="text-lg font-semibold">Payment outcomes</h2>
          {state.payments.length === 0 && <p className="mt-2 text-sm text-[var(--mm-muted)]">Payment activity will appear after checkout runs.</p>}
          {Object.entries(state.payments.reduce<Record<string, number>>((counts, payment) => ({ ...counts, [payment.status]: (counts[payment.status] ?? 0) + 1 }), {})).map(([status, count]) => (
            <div key={status} className="mt-3">
              <div className="flex justify-between text-sm"><span>{status.replaceAll("_", " ")}</span><span>{count}</span></div>
              <progress className="w-full accent-[var(--mm-accent)]" aria-label={status} max={state.payments.length} value={count} />
            </div>
          ))}
          <Button className="mt-4" variant="secondary" onClick={() => setPage("reports")}>Open reports</Button>
        </Card>
      </>}
    </div>
  );
}

function Scoreboard({ data }: { data?: CommandData }) {
  return <Card className="p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-xl font-semibold">Deployment scoreboard</h2><p className="mt-1 text-sm text-[var(--mm-muted)]">Checks run against this deployment. Maximum score 100.</p></div>
      <p className="text-3xl font-semibold tabular-nums">{data?.score ?? "–"}<span className="ml-1 text-lg text-[var(--mm-muted)]">/100</span></p>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-2">{data?.checks.map((check) => (
      <div key={check.id} className="flex gap-2 rounded-xl border border-[var(--mm-border)] p-3">
        {check.passed ? <CircleCheck size={18} className="shrink-0 text-emerald-600" /> : <CircleMinus size={18} className="shrink-0 text-amber-600" />}
        <div><p className="text-sm font-medium">{check.label} <span className="text-xs text-[var(--mm-muted)]">· {check.weight} pts</span></p><p className="mt-1 text-xs text-[var(--mm-muted)]">{check.detail}</p></div>
      </div>
    ))}</div>
  </Card>;
}

function WebhookSimulator() {
  const [scenario, setScenario] = useState("valid");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  return <Card className="p-5">
    <Code2 size={20} />
    <h2 className="mt-2 text-lg font-semibold">Webhook verification simulator</h2>
    <p className="mt-1 text-sm text-[var(--mm-muted)]">Exercises the same verifier pipeline on temporary data.</p>
    <form className="mt-4 flex flex-wrap gap-2" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      try {
        const data = await request<{ status: number; result: string }>("/api/security/webhook-simulator", post({ scenario }));
        setResult(`Simulation · HTTP ${data.status} · ${data.result}`);
      } catch (err) {
        setResult(err instanceof Error ? err.message : "Simulation failed.");
      } finally {
        setBusy(false);
      }
    }}>
      <select aria-label="Webhook scenario" value={scenario} onChange={(event) => setScenario(event.target.value)} className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-surface)] p-2 text-sm">
        <option value="valid">Valid signature</option><option value="invalid">Invalid signature</option><option value="stale">Stale transmission</option><option value="duplicate">Duplicate event</option><option value="missing_headers">Missing headers</option>
      </select>
      <Button type="submit" disabled={busy}>Run simulation</Button>
    </form>
    {result && <p role="status" className="mt-3 font-mono text-sm">{result}</p>}
  </Card>;
}

function MoneyOS({ state, setPage, payoutConfigured, refresh }: { state: Snapshot; setPage: (page: PageId) => void; payoutConfigured: boolean; refresh: () => Promise<void> }) {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [cart, setCart] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [lookup, setLookup] = useState<"payout" | "vault" | "tracking">("payout");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [payoutKey, setPayoutKey] = useState("");
  const [cartKeys, setCartKeys] = useState<Record<string, string>>({});
  const [tradeoffs, setTradeoffs] = useState<Record<string, { message: string; approvalId?: string }>>({});

  const propose = async (sku: string) => {
    setBusy(true);
    const key = cartKeys[sku] || crypto.randomUUID();
    setCartKeys((current) => ({ ...current, [sku]: key }));
    try {
      let approvalId = tradeoffs[sku]?.approvalId;
      if (tradeoffs[sku] && !approvalId) {
        const response = await request<{ approval: { approval_id: string } }>("/api/purchases/approvals", post({ sku }));
        approvalId = response.approval.approval_id;
        setTradeoffs((current) => ({ ...current, [sku]: { ...current[sku], approvalId } }));
      }
      const result = await request<{ error?: string; message?: string; status?: string; analysis?: { tradeoffs?: string[] } }>("/api/purchases", post({ sku, approval_id: approvalId }, key));
      setCartKeys((current) => Object.fromEntries(Object.entries(current).filter(([item]) => item !== sku)));
      if (result.status === "needs_user_approval") {
        const message = result.analysis?.tradeoffs?.join(" ") || result.error || "Review the trade-offs in the Money Coach.";
        setTradeoffs((current) => ({ ...current, [sku]: { message } }));
        setResult(message);
        return;
      }
      if (result.error) throw new Error(result.message || result.error);
      setResult(JSON.stringify(result, null, 2));
      setCart((current) => current.filter((item) => item !== sku));
      setTradeoffs((current) => Object.fromEntries(Object.entries(current).filter(([item]) => item !== sku)));
      await refresh();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Proposal failed.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    request<{ merchants: Merchant[] }>("/api/merchants").then((data) => setMerchants(data.merchants)).catch((err: Error) => setResult(err.message));
  }, []);
  const products = merchants.flatMap((merchant) => merchant.products.filter((p) => !p.recurring).map((product) => ({ ...product, merchant: merchant.name })));
  const submit = async (event: FormEvent, payload: unknown, key?: string) => {
    event.preventDefault();
    setBusy(true);
    setResult("");
    try {
      const response = await request<Record<string, unknown>>("/api/paypal-workbench", post(payload, key));
      setResult(JSON.stringify(response, null, 2));
      if (key) { setPayoutKey(""); setAmount(""); setConfirmed(false); }
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  };
  const controls: [string, PageId][] = [["Orders and capture", "vault"], ["Refunds and disputes", "refunds"], ["Invoices and plans", "invoices"], ["Subscriptions", "subscriptions"], ["Payment links", "links"]];
  return <div className="grid gap-4">
    <Card className="p-6"><h1 className="text-3xl font-semibold">Money OS</h1><p className="mt-2 text-sm text-[var(--mm-muted)]">Review orders, capture and refund history, and owner-only PayPal operations.</p>
      <div className="mt-4 flex flex-wrap gap-2">{controls.map(([label, page]) => <Button key={page} variant="secondary" onClick={() => setPage(page)}>{label}</Button>)}</div>
    </Card>
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Order → Capture → Refund</h2>
      <div className="mt-2 max-h-64 divide-y divide-[var(--mm-border)] overflow-auto">{state.payments.length === 0 ? <p className="py-2 text-sm text-[var(--mm-muted)]">No orders in this workspace yet.</p> : state.payments.slice().reverse().map((payment) => (
        <div key={payment.payment_id} className="flex items-center justify-between gap-3 py-3 text-sm">
          <div><p className="font-medium">{payment.merchant_name}</p><code className="text-xs text-[var(--mm-muted)]">{payment.paypal?.order_id ?? payment.payment_id}</code></div>
          <div className="text-right"><p>{payment.currency} {payment.amount.toFixed(2)}</p><p className="text-xs text-[var(--mm-muted)]">{payment.status.replaceAll("_", " ")}</p></div>
        </div>
      ))}</div>
    </Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="text-lg font-semibold">Demo catalog</h2>
        <ul className="mt-2 max-h-72 divide-y divide-[var(--mm-border)] overflow-auto">{products.map((product) => (
          <li key={product.sku} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div><p>{product.name}</p><p className="text-xs text-[var(--mm-muted)]">{product.merchant} · {product.currency} {product.amount}</p></div>
            <Button variant="secondary" disabled={cart.includes(product.sku)} onClick={() => setCart((current) => [...current, product.sku])}>{cart.includes(product.sku) ? "In cart" : "Add"}</Button>
          </li>
        ))}</ul>
      </Card>
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><ShoppingCart size={18} /> Cart</h2>
        <p className="mt-1 text-sm text-[var(--mm-muted)]">Submit each item for its own AgentPaL Guard decision.</p>
        <ul className="mt-2 divide-y divide-[var(--mm-border)]">{cart.map((sku) => (
          <li key={sku} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div><p>{products.find((product) => product.sku === sku)?.name ?? sku}</p>
              {tradeoffs[sku] && <p className="mt-1 text-xs text-[var(--mm-muted)]">{tradeoffs[sku].message}</p>}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" disabled={busy} onClick={() => setCart((current) => current.filter((item) => item !== sku))}>Remove</Button>
              <Button disabled={busy} onClick={() => propose(sku)}>{tradeoffs[sku] ? "Accept trade-offs & propose" : "Propose"}</Button>
            </div>
          </li>
        ))}</ul>
        {cart.length === 0 && <p className="mt-4 text-sm text-[var(--mm-muted)]">Add a catalog item to start a proposal.</p>}
      </Card>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="text-lg font-semibold">Sandbox lookups</h2>
        <p className="mt-1 text-sm text-[var(--mm-muted)]">Look up a payout batch, saved payment token type, or shipment tracker.</p>
        <form className="mt-4 grid gap-2" onSubmit={(event) => submit(event, { kind: lookup, reference })}>
          <select aria-label="Resource" value={lookup} onChange={(event) => setLookup(event.target.value as typeof lookup)} className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-surface)] p-2">
            <option value="payout">Payout batch</option><option value="vault">Vault payment token</option><option value="tracking">Shipment tracker</option>
          </select>
          <input aria-label="PayPal reference" required value={reference} onChange={(event) => setReference(event.target.value)} placeholder="PayPal reference" className="rounded-lg border border-[var(--mm-border)] bg-transparent p-2" />
          <Button disabled={busy} type="submit">Look up</Button>
        </form>
        <p className="mt-4 text-xs text-[var(--mm-muted)]">Pay Later availability depends on the merchant and buyer. <a href="https://developer.paypal.com/docs/checkout/pay-later/" className="underline">PayPal Pay Later documentation</a></p>
      </Card>
      <Card className="p-5">
        <h2 className="text-lg font-semibold">Sandbox payout</h2>
        <p className="mt-1 text-sm text-[var(--mm-muted)]">Send up to USD 25 to the fixed sandbox recipient configured by the owner.</p>
        {payoutConfigured ? <form className="mt-4 grid gap-2" onSubmit={(event) => {
          const key = payoutKey || crypto.randomUUID();
          setPayoutKey(key);
          return submit(event, { kind: "send_payout", amount: Number(amount), confirmed }, key);
        }}>
          <input aria-label="Payout amount in USD" type="number" min="0.01" max="25" step="0.01" required value={amount} disabled={Boolean(payoutKey)} onChange={(event) => setAmount(event.target.value)} className="rounded-lg border border-[var(--mm-border)] bg-transparent p-2" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I confirm this sandbox payout.</label>
          <Button disabled={!confirmed || busy} type="submit">{payoutKey ? "Retry same payout" : "Send sandbox payout"}</Button>
        </form> : <p className="mt-4 text-sm text-[var(--mm-muted)]">Set the sandbox PayPal credentials and payout test recipient to enable this form.</p>}
      </Card>
    </div>
    {result && <Card className="p-5"><h2 className="text-sm font-semibold">Latest operation</h2><pre role="status" className="mt-2 overflow-auto whitespace-pre-wrap break-words text-xs">{result}</pre></Card>}
  </div>;
}
