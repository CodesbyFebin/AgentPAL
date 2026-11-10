import { id, nowIso } from "./ids";
import type { Currency, SpendReservation, StoreData } from "./types";
import { remainingBudget } from "./store";

export function intentKey(parts: {
  mandate_id: string;
  merchant_id: string;
  sku: string;
  amount: number;
  currency: string;
}): string {
  return [parts.mandate_id, parts.merchant_id, parts.sku, parts.amount.toFixed(2), parts.currency].join(":");
}

export function findOpenIntent(store: StoreData, key: string) {
  const reservation = store.reservations.find((r) => r.intent_key === key && r.status === "reserved");
  const payment = reservation?.payment_id
    ? store.payments.find((p) => p.payment_id === reservation.payment_id)
    : store.payments.find((p) => p.idempotency_key === key && !["denied", "failed", "voided", "refunded"].includes(p.status));
  return { reservation, payment };
}

/** Reserve mandate budget atomically inside a store mutation. Throws if the total limit would be exceeded. */
export function reserveSpend(
  store: StoreData,
  opts: {
    mandate_id: string;
    intent_key: string;
    amount: number;
    currency: Currency;
    payment_id?: string;
  },
): { reservation: SpendReservation; deduped: boolean } {
  const existing = findOpenIntent(store, opts.intent_key);
  if (existing.reservation && existing.reservation.status === "reserved") {
    return { reservation: existing.reservation, deduped: true };
  }
  const remaining = remainingBudget(store, opts.mandate_id);
  if (opts.amount > remaining + 1e-9) {
    throw new Error(
      `Cannot reserve ${opts.amount} against mandate ${opts.mandate_id}: only ${remaining} remains under the total limit (atomic reservation prevents a double-spend).`,
    );
  }
  const reservation: SpendReservation = {
    reservation_id: id("rsv"),
    mandate_id: opts.mandate_id,
    intent_key: opts.intent_key,
    payment_id: opts.payment_id,
    amount: opts.amount,
    currency: opts.currency,
    status: "reserved",
    created_at: nowIso(),
  };
  store.reservations.push(reservation);
  return { reservation, deduped: false };
}

export function releaseReservation(store: StoreData, paymentId: string) {
  for (const r of store.reservations) {
    if (r.payment_id === paymentId && r.status === "reserved") r.status = "released";
  }
}
