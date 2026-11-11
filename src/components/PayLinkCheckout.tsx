"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BraintreeCheckout } from "@/components/BraintreeCheckout";
import { Badge, Button, Card, LogoMark } from "@/components/ui/kit";
import { formatMoney } from "@/lib/money";

const DEMO_QR_DISCLAIMER = "Demo QR — opens AgentPaL checkout, not a real UPI request";
import type { Payment, PaymentLink, PolicyDecision } from "@/lib/types";
import type { PaymentMode } from "@/lib/payment-mode";
import { applyThemeToDocument, DEFAULT_THEME_PREFS, parseThemePrefs, THEME_STORAGE_KEY } from "@/lib/ui-themes";
import { DEFAULT_ZEN_PREFS, ZEN_STORAGE_KEY, parseZenPrefs, shouldZenPause } from "@/lib/zen";
import { ZenPauseDialog, type ZenRequest } from "@/components/ui/ZenPauseDialog";

type LinkView = PaymentLink & { url?: string; path?: string; qr_disclaimer?: string };

export function PayLinkCheckout({ linkId }: { linkId: string }) {
  const [link, setLink] = useState<LinkView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [decision, setDecision] = useState<PolicyDecision | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);
  const [zenPrefs] = useState(() => parseZenPrefs(typeof window !== "undefined" ? localStorage.getItem(ZEN_STORAGE_KEY) : null) ?? DEFAULT_ZEN_PREFS);
  const [zenRequest, setZenRequest] = useState<(ZenRequest & { resolve: (ok: boolean) => void }) | null>(null);

  const requestZenPause = (amount: number, currency: string, label?: string) => {
    if (!shouldZenPause(amount, currency, zenPrefs)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setZenRequest({ amount, currency, label, resolve }));
  };

  useEffect(() => {
    const prefs = parseThemePrefs(typeof window !== "undefined" ? localStorage.getItem(THEME_STORAGE_KEY) : null);
    applyThemeToDocument(prefs || DEFAULT_THEME_PREFS);
  }, []);

  const refresh = async () => {
    const res = await fetch(`/api/pay-links/${encodeURIComponent(linkId)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Payment link not found");
    setLink(body.link);
    if (!amount && body.link?.amount_cap) setAmount(String(body.link.amount_cap));
  };

  useEffect(() => {
    refresh().catch((err: Error) => setError(err.message));
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { paymentMode?: PaymentMode }) => d.paymentMode && setPaymentMode(d.paymentMode))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkId]);

  const payable = link && link.status === "active";

  const startPay = async () => {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay-links/${encodeURIComponent(link.link_id)}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Payment could not start");
      setPayment(body.payment || null);
      setDecision(body.decision || null);
      if (body.link) setLink(body.link);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment could not start");
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    if (!payment) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await requestZenPause(payment.amount, payment.currency, payment.merchant_name);
      if (!ok) {
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/payments/${payment.payment_id}/simulate-buyer`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Simulate failed");
      setPayment(body.payment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulate failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <LogoMark />
        <div>
          <p className="font-semibold">AgentPaL checkout</p>
          <p className="text-xs text-[var(--mm-muted)]">Signed mandate payment link · Guard still decides</p>
        </div>
      </div>

      <p className="mb-4 rounded-2xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        {DEMO_QR_DISCLAIMER}. Seeded demo data only. AgentPaL is an independent hackathon project built on PayPal APIs.
        It is not a PayPal product and is not endorsed by PayPal.
      </p>

      {!link && !error && <p className="text-sm text-[var(--mm-muted)]">Loading payment link…</p>}
      {error && <p className="mb-3 text-sm text-[var(--mm-danger)]">{error}</p>}

      {link && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold">{link.description || link.merchant_name || "Mandate payment link"}</h1>
              <p className="mt-1 text-sm text-[var(--mm-muted)]">
                Cap {formatMoney(link.amount_cap, link.currency)} · {link.use_type} use ({link.use_count}/{link.max_uses}) · expires {new Date(link.expires_at).toLocaleString("en-IN", { timeZone: "Asia/Calcutta" })} IST
              </p>
            </div>
            <Badge tone={link.status === "active" ? "success" : "danger"}>{link.status}</Badge>
          </div>

          <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-subtle)] p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/pay-links/${encodeURIComponent(link.link_id)}/qr`} alt="Demo QR for AgentPaL checkout" className="h-52 w-52 rounded-xl bg-white p-2" />
            <p className="text-center text-xs font-medium text-[var(--mm-muted)]">{DEMO_QR_DISCLAIMER}</p>
          </div>

          {payable && !payment && (
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                Amount ({link.currency})
                <input
                  className="mt-1 w-full rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg)] px-3 py-2 text-sm"
                  type="number"
                  min={0}
                  step="0.01"
                  max={link.amount_cap}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <Button disabled={busy} onClick={() => void startPay()}>
                {busy ? "Checking policy…" : "Pay through AgentPaL Guard"}
              </Button>
              <p className="text-xs text-[var(--mm-muted)]">
                The amount cannot exceed this link&apos;s cap. AgentPaL Guard then applies the mandate, merchant allowlist, and kill switch before any checkout starts.
              </p>
            </div>
          )}

          {decision && (
            <p className="mt-3 text-sm">
              Policy decision: <strong>{decision.decision}</strong> — {decision.reason}
            </p>
          )}

          {payment && (
            <div className="mt-4 space-y-2">
              <p className="text-sm">
                Payment {payment.payment_id} · {formatMoney(payment.amount, payment.currency)} · {payment.status}
              </p>
              {payment.status === "awaiting_approval" && (
                <p className="text-sm text-[var(--mm-muted)]">A human approval is required. Open AgentPaL → Agents to approve or deny.</p>
              )}
              {payment.status === "awaiting_buyer" && payment.rail === "braintree_sandbox" && paymentMode?.startsWith("braintree") && (
                <BraintreeCheckout
                  paymentId={payment.payment_id}
                  amountUsd={payment.braintree?.settlement_amount ?? (payment.currency === "INR" ? payment.amount / 83 : payment.amount)}
                  onBeforePay={() => requestZenPause(payment.amount, payment.currency, payment.merchant_name)}
                  onComplete={async () => {
                    const res = await fetch(`/api/payments/${payment.payment_id}/authorize`, { method: "GET" }).catch(() => null);
                    void res;
                    const status = await fetch("/api/status").then((r) => r.json());
                    const next = (status.payments as Payment[] | undefined)?.find((p) => p.payment_id === payment.payment_id);
                    if (next) setPayment(next);
                  }}
                />
              )}
              {payment.status === "awaiting_buyer" && payment.paypal?.approve_url && payment.paypal.mode !== "mock" && payment.rail !== "braintree_sandbox" && (
                <Button variant="secondary" href={payment.paypal.approve_url}>Open PayPal approval</Button>
              )}
              {payment.status === "awaiting_buyer" && paymentMode === "mock" && (
                <Button disabled={busy} onClick={() => void simulate()}>Simulate sandbox approval</Button>
              )}
            </div>
          )}
        </Card>
      )}

      <p className="mt-6 text-center text-xs text-[var(--mm-muted)]">
        <Link className="underline" href="/?tab=links">Back to AgentPaL payment links</Link>
      </p>
      <ZenPauseDialog
        open={Boolean(zenRequest)}
        request={zenRequest}
        prefs={zenPrefs}
        onConfirm={() => {
          const req = zenRequest;
          setZenRequest(null);
          req?.resolve(true);
        }}
        onCancel={() => {
          const req = zenRequest;
          setZenRequest(null);
          req?.resolve(false);
        }}
      />
    </main>
  );
}
