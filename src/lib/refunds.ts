import { appendEvent } from "./events";
import { id, nowIso } from "./ids";
import { inrToUsd } from "./money";
import { refundReservedPayment } from "./payment-provider";
import type { Payment, RefundRecord, StoreData } from "./types";

export function settledUsd(payment: Payment): number {
  return (
    payment.braintree?.settlement_amount ??
    payment.paypal?.settlement_amount ??
    (payment.currency === "INR" ? inrToUsd(payment.amount) : payment.amount)
  );
}

export function refundedUsd(store: StoreData, paymentId: string): number {
  return round2(
    store.refunds.filter((r) => r.payment_id === paymentId && r.status === "COMPLETED").reduce((s, r) => s + r.amount, 0),
  );
}

export function refundableUsd(store: StoreData, payment: Payment): number {
  if (!["captured", "settled"].includes(payment.status)) return 0;
  return Math.max(0, round2(settledUsd(payment) - refundedUsd(store, payment.payment_id)));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export interface RefundRequest {
  payment_id: string;
  /** USD. Omit for a full refund of what remains. */
  amount?: number;
  reason: string;
  /** Stable per logical refund (from Idempotency-Key). Sent to PayPal as PayPal-Request-Id. */
  idempotency_key?: string;
}

/**
 * AgentPaL Guard refund: kill switch, reason, finite positive amount, cap = captured minus already
 * refunded. Blocked refunds never call the processor. Every outcome is audited.
 */
export async function guardedRefund(store: StoreData, req: RefundRequest): Promise<RefundRecord> {
  const payment = store.payments.find((p) => p.payment_id === req.payment_id);
  const local_id = id("rfd");
  const paypal_request_id = `refund-${req.payment_id}-${(req.idempotency_key || local_id).slice(0, 80)}`;
  const reason = (req.reason || "").trim();
  const block = (why: string, amount = req.amount ?? 0): RefundRecord => {
    const evt = appendEvent(store, "refund.blocked", `Refund blocked by AgentPaL Guard: ${why}`, {
      payment_id: req.payment_id,
      amount,
      reason: reason.slice(0, 200),
    });
    const rec: RefundRecord = {
      refund_id: local_id,
      payment_id: req.payment_id,
      amount: Number.isFinite(amount) ? amount : 0,
      currency: "USD",
      reason: reason.slice(0, 200),
      kind: "partial",
      status: "BLOCKED",
      provider: "mock",
      mode: "mock",
      paypal_request_id,
      block_reason: why,
      event_hash: evt.hash,
      created_at: nowIso(),
    };
    store.refunds.push(rec);
    return rec;
  };

  if (store.settings.kill_switch) return block("Kill switch is on. No refunds or other money movement until a human turns it off.");
  if (!payment) return block("Payment not found.");
  if (reason.length < 3) return block("A refund reason (at least 3 characters) is required.");
  const remaining = refundableUsd(store, payment);
  if (remaining <= 0) return block(`Nothing refundable: payment is ${payment.status} and USD ${refundedUsd(store, payment.payment_id).toFixed(2)} was already refunded.`);
  const amount = req.amount === undefined ? remaining : req.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return block("Refund amount must be a finite number greater than zero.", 0);
  if (round2(amount) - remaining > 1e-9) {
    return block(`USD ${amount.toFixed(2)} exceeds the refundable cap of USD ${remaining.toFixed(2)} (captured minus already refunded).`, amount);
  }
  const kind: RefundRecord["kind"] = Math.abs(round2(amount) - settledUsd(payment)) < 1e-9 && refundedUsd(store, payment.payment_id) === 0 ? "full" : "partial";

  let provider: RefundRecord["provider"] = "mock";
  let mode: RefundRecord["mode"] = "mock";
  let provider_refund_id: string | undefined;
  if (payment.rail === "x402_usdc") {
    provider = "x402";
    provider_refund_id = `SIMULATED-${local_id}`;
  } else {
    const captureId = payment.braintree?.capture_id || payment.paypal?.capture_id;
    if (!captureId) return block("Payment has no capture id to refund.", amount);
    try {
      const ref = await refundReservedPayment(captureId, payment.rail, round2(amount), "USD", paypal_request_id);
      provider = ref.provider;
      mode = ref.mode;
      provider_refund_id = ref.refund_id;
    } catch (err) {
      const msg = (err instanceof Error ? err.message : "refund failed").slice(0, 200);
      const evt = appendEvent(store, "refund.failed", `Refund failed at the processor: ${msg}`, { payment_id: payment.payment_id, amount });
      const rec: RefundRecord = { refund_id: local_id, payment_id: payment.payment_id, amount, currency: "USD", reason, kind, status: "FAILED", provider: payment.rail === "braintree_sandbox" ? "braintree" : "paypal", mode: "sandbox", paypal_request_id, block_reason: msg, event_hash: evt.hash, created_at: nowIso() };
      store.refunds.push(rec);
      return rec;
    }
  }

  const fullyRefunded = round2(refundedUsd(store, payment.payment_id) + amount) >= round2(settledUsd(payment));
  if (fullyRefunded) payment.status = "refunded";
  payment.updated_at = nowIso();
  if (payment.braintree && provider === "braintree") payment.braintree.refund_id = provider_refund_id;
  if (payment.paypal && provider !== "braintree") payment.paypal.refund_id = provider_refund_id;
  const label = mode === "mock" ? "MOCK refund (no processor call)" : provider === "braintree" ? "Braintree sandbox refund" : provider === "x402" ? "Simulated x402 refund" : "PayPal sandbox refund";
  const evt = appendEvent(store, "refund.completed", `${label} ${provider_refund_id} of USD ${amount.toFixed(2)} (${kind}) — reason: ${reason.slice(0, 120)}`, {
    payment_id: payment.payment_id,
    goal_id: payment.goal_id,
    refund_id: provider_refund_id,
    amount,
    kind,
    mode,
    provider,
    paypal_request_id,
  });
  const rec: RefundRecord = {
    refund_id: local_id,
    payment_id: payment.payment_id,
    amount: round2(amount),
    currency: "USD",
    reason,
    kind,
    status: "COMPLETED",
    provider,
    mode,
    provider_refund_id,
    paypal_request_id,
    event_hash: evt.hash,
    created_at: nowIso(),
  };
  store.refunds.push(rec);
  return rec;
}
