"use client";

import { useEffect, useRef } from "react";
import { Badge, Button, Card } from "@/components/ui/kit";
import type { RunFn, Snapshot } from "@/components/app-types";
import type { PayPalToolCall } from "@/lib/types";

const ALLOWLIST = ["create_order", "get_order", "list_invoices", "show_subscription_details"];

function tone(d: PayPalToolCall["decision"]) {
  return d === "EXECUTED" ? "success" : d === "NEEDS_APPROVAL" ? "warning" : "danger";
}

async function runDemo() {
  const res = await fetch("/api/coach/paypal-tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ demo: true }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "demo failed");
}

/** Coach's PayPal agent-toolkit actions, each wrapped by AgentPaL Guard. */
export function PayPalToolkitCard({ state, run }: { state: Snapshot; run: RunFn }) {
  const calls = [...(state.paypal_tool_calls || [])].reverse().slice(0, 6);
  const mode = state.modes.agentToolkit || "mock";
  const hasMandate = (state.mandates || []).some((m) => m.goal_id === "coach_paypal_tools" && m.status === "active");
  const auto = useRef(false);

  useEffect(() => {
    if (auto.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("toolsdemo") === "1" && !(state.paypal_tool_calls || []).length) {
      auto.current = true;
      void run("Running Guard-wrapped PayPal toolkit demo…", runDemo);
    }
  }, [run, state.paypal_tool_calls]);

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">PayPal agent tools, behind AgentPaL Guard</h3>
        <Badge tone={mode === "live" ? "success" : "warning"}>{mode === "live" ? "toolkit · sandbox" : "toolkit · MOCK"}</Badge>
      </div>
      <p className="mt-1 text-xs text-[var(--mm-muted)]">
        Coach proposes actions with PayPal&apos;s open-source agent toolkit. Each call passes the tool allowlist, kill switch,
        mandate cap and reservation first, then is written to the hash-chained audit log with a signed receipt. Blocked
        calls never reach PayPal, and Coach cannot capture money.
        {mode === "mock" && " PayPal sandbox credentials are not set, so allowed calls return results marked MOCK."}
      </p>
      <p className="mt-2 text-[11px] text-[var(--mm-muted)]">Allowlist: {ALLOWLIST.join(" · ")}</p>
      <p className="mt-1 text-[11px] text-[var(--mm-muted)]">
        Mandate: {hasMandate ? "Coach PayPal tools — USD 100 total, USD 50 per order, Nameforge + DevTools only (signed by you)" : "not signed — allowed calls stay blocked until you sign it. Coach cannot create authority."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!hasMandate && (
          <Button onClick={() => run("Signing Coach PayPal tools mandate…", async () => {
            const r = await fetch("/api/mandates/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template: "coach_paypal_tools" }) });
            if (!r.ok) throw new Error((await r.json()).error || "sign failed");
          })}>Sign Coach tools mandate</Button>
        )}
        <Button variant="secondary" onClick={() => run("Running Guard-wrapped PayPal toolkit demo…", runDemo)}>
          Run Guard demo (1 allowed, 2 blocked)
        </Button>
      </div>
      <ul className="mt-3 space-y-2">
        {calls.length === 0 && <li className="text-xs text-[var(--mm-muted)]">No toolkit calls yet. Try “Create a PayPal order for $12 at Nameforge Domains”.</li>}
        {calls.map((c) => (
          <li key={c.call_id} className="rounded-xl border border-[var(--mm-border)] p-2 text-xs" data-testid="toolkit-call">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono">{c.tool}{c.merchant_name ? ` · ${c.merchant_name}` : ""}{c.amount != null ? ` · USD ${c.amount.toFixed(2)}` : ""}</span>
              <Badge tone={tone(c.decision)}>{c.decision === "BLOCKED" ? "BLOCKED by Guard" : c.decision}{c.invoked && c.mode === "mock" ? " · MOCK" : ""}</Badge>
            </div>
            <p className="mt-1 text-[var(--mm-muted)]">{c.reason.slice(0, 220)}</p>
            <p className="mt-1 text-[10px] text-[var(--mm-muted)]">
              {c.invoked ? "Toolkit invoked" : "Toolkit NOT invoked"} · receipt {c.receipt.receipt_id} · audit {c.receipt.event_hash.slice(0, 10)}…
              {c.invoked && c.result && typeof c.result === "object" && "id" in c.result ? ` · result ${(c.result as { id: string }).id}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
