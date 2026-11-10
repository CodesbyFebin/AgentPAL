import { appendEvent } from "./events";
import { id, nowIso } from "./ids";
import { formatMoney } from "./money";
import { cancelSubscription } from "./paypal";
import { evaluatePolicy } from "./policy";
import type { ManagedSubscription, Mandate, PriceChange, PriceChangeSource, RenewalReview, StoreData } from "./types";
import { isMaterialShift, lifecycleOf, makePriceChange } from "./subscription-metrics";

export { annualizedDelta, isMaterialShift, lifecycleOf, MATERIAL_PRICE_SHIFT, raisedThisYear } from "./subscription-metrics";

export function recordPriceChange(
  sub: ManagedSubscription,
  next: number,
  source: PriceChangeSource,
  at = nowIso(),
): PriceChange {
  const change = makePriceChange(sub.amount, next, source, id("px"), at);
  sub.price_history = [...(sub.price_history || []), change];
  sub.expected_amount_min = Math.min(sub.expected_amount_min ?? sub.amount, next, sub.amount);
  sub.expected_amount_max = Math.max(sub.expected_amount_max ?? sub.amount, next, sub.amount);
  return change;
}


export const SUBSCRIPTION_CAP_USD = 30;

export function monthlySubscriptionSpend(store: StoreData, exceptId?: string): number {
  return store.subscriptions
    .filter((s) => !["ended", "paused"].includes(lifecycleOf(s)) && s.status !== "ended" && s.subscription_id !== exceptId)
    .filter((s) => lifecycleOf(s) === "active" || s.status === "pending_renewal" || s.status === "active")
    .reduce((sum, s) => sum + s.amount, 0);
}

export function seedDemoSubscriptions(store: StoreData, mandate?: Mandate): ManagedSubscription[] {
  if (store.subscriptions.some((s) => s.created_via === "moneymate_mesh")) {
    return store.subscriptions;
  }
  const now = new Date();
  const next = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows: Array<Pick<ManagedSubscription, "merchant_id" | "merchant_name" | "plan_name" | "amount" | "currency" | "interval" | "paypal_subscription_id" | "mandate_id" | "next_billing_at">> = [
    {
      merchant_id: "merchant_clouddraw",
      merchant_name: "CloudDraw Pro (demo)",
      plan_name: "CloudDraw Pro monthly",
      amount: 12,
      currency: "USD",
      interval: "monthly",
      paypal_subscription_id: "MOCK-SUB-CLOUDDRAW",
      mandate_id: mandate?.mandate_id,
      next_billing_at: next,
    },
    {
      merchant_id: "merchant_logsense",
      merchant_name: "Logsense (demo)",
      plan_name: "Logsense Team monthly",
      amount: 10,
      currency: "USD",
      interval: "monthly",
      paypal_subscription_id: "MOCK-SUB-LOGSENSE",
      mandate_id: mandate?.mandate_id,
      next_billing_at: next,
    },
    {
      merchant_id: "merchant_stackmail",
      merchant_name: "StackMail (demo)",
      plan_name: "StackMail monthly",
      amount: 8,
      currency: "USD",
      interval: "monthly",
      paypal_subscription_id: "MOCK-SUB-STACKMAIL",
      mandate_id: mandate?.mandate_id,
      next_billing_at: next,
    },
  ];
  const created: ManagedSubscription[] = rows.map((r) => ({
    ...r,
    subscription_id: id("sub"),
    status: "active",
    lifecycle: "active",
    bill_type: "subscription",
    expected_amount_min: r.amount,
    expected_amount_max: r.amount,
    price_history: [],
    created_via: "moneymate_mesh",
    created_at: nowIso(),
  }));
  store.subscriptions.push(...created);
  appendEvent(
    store,
    "subscriptions.seeded",
    "Seeded three demo software subscriptions created through the MoneyMate Mesh merchant integration (CloudDraw $12, Logsense $10, StackMail $8). Only these are managed — we do not intercept every renewal on a consumer PayPal account.",
    { subscription_ids: created.map((s) => s.subscription_id), monthly_total: 30 },
  );
  return created;
}

export function evaluateRenewal(
  store: StoreData,
  subscription: ManagedSubscription,
  proposedAmount: number,
): RenewalReview {
  const mandate = store.mandates.find((m) => m.mandate_id === subscription.mandate_id) ?? store.mandates.find((m) => m.allow_recurring);
  const priceIncreased = proposedAmount > subscription.amount + 1e-9;
  const others = monthlySubscriptionSpend(store, subscription.subscription_id);
  const nextTotal = others + proposedAmount;

  let decision: RenewalReview["decision"] = "ALLOW";
  let reason = `Renewal of ${subscription.plan_name} at ${formatMoney(proposedAmount, subscription.currency)} keeps monthly software spend at ${formatMoney(nextTotal, "USD")}, within the ${formatMoney(SUBSCRIPTION_CAP_USD, "USD")} cap.`;

  if (store.settings.kill_switch) {
    decision = "DENY";
    reason = "Kill switch is on. Renewals are frozen.";
  } else if (!mandate || mandate.status !== "active") {
    decision = "DENY";
    reason = "No active recurring mandate covers this subscription.";
  } else if (!mandate.approved_merchants.includes(subscription.merchant_id)) {
    decision = "DENY";
    reason = `${subscription.merchant_name} is not on the subscription mandate allowlist.`;
  } else if (nextTotal > (mandate.max_total_spend || SUBSCRIPTION_CAP_USD) + 1e-9) {
    decision = "REQUIRE_APPROVAL";
    reason = `A renewal at ${formatMoney(proposedAmount, "USD")} would take monthly software spend to ${formatMoney(nextTotal, "USD")}, over the ${formatMoney(mandate.max_total_spend, "USD")} cap${priceIncreased ? " after a price increase" : ""}. A human must approve or we can cancel it.`;
  } else if (priceIncreased && isMaterialShift(subscription.amount, proposedAmount)) {
    decision = "REQUIRE_APPROVAL";
    reason = `${subscription.plan_name} has a material price increase (${formatMoney(subscription.amount, "USD")} → ${formatMoney(proposedAmount, "USD")}, ≥10%). Material increases require approval.`;
  } else if (priceIncreased) {
    decision = "REQUIRE_APPROVAL";
    reason = `${subscription.plan_name} increased from ${formatMoney(subscription.amount, "USD")} to ${formatMoney(proposedAmount, "USD")}. Price increases require approval even when the cap still holds.`;
  } else if (mandate) {
    const merchant = store.merchants.find((m) => m.merchant_id === subscription.merchant_id);
    if (merchant) {
      const policy = evaluatePolicy({
        mandate,
        merchant,
        amount: proposedAmount,
        currency: subscription.currency,
        category: "software",
        recurring: true,
        mandateSpend: others,
        killSwitch: store.settings.kill_switch,
      });
      decision = policy.decision;
      reason = policy.reason;
    }
  }

  const review: RenewalReview = {
    review_id: id("ren"),
    subscription_id: subscription.subscription_id,
    proposed_amount: proposedAmount,
    previous_amount: subscription.amount,
    price_increased: priceIncreased,
    decision,
    reason,
    created_at: nowIso(),
  };
  store.renewal_reviews.push(review);
  if (priceIncreased) recordPriceChange(subscription, proposedAmount, "detected");
  subscription.status = decision === "ALLOW" ? "active" : "pending_renewal";
  if (decision === "ALLOW") subscription.lifecycle = "active";
  subscription.last_renewal_amount = proposedAmount;
  appendEvent(store, "subscription.renewal_reviewed", `${decision}: ${reason}`, {
    subscription_id: subscription.subscription_id,
    review_id: review.review_id,
    decision,
    proposed_amount: proposedAmount,
    previous_amount: subscription.amount,
  });
  return review;
}

export async function cancelManagedSubscription(store: StoreData, subscriptionId: string, reason: string) {
  const sub = store.subscriptions.find((s) => s.subscription_id === subscriptionId);
  if (!sub) throw new Error("Subscription not found");
  if (lifecycleOf(sub) === "ended") return sub;
  const paypalId = sub.paypal_subscription_id || sub.subscription_id;
  const result = await cancelSubscription(paypalId, reason);
  sub.status = "ended";
  sub.lifecycle = "ended";
  sub.cancelled_at = nowIso();
  sub.cancel_reason = reason;
  appendEvent(
    store,
    "subscription.cancelled",
    `Cancelled ${sub.plan_name} via PayPal Subscriptions API (${result.mode} mode): ${reason}`,
    {
      subscription_id: sub.subscription_id,
      paypal_subscription_id: paypalId,
      mode: result.mode,
      reason,
    },
  );
  return sub;
}

/** Demo webhook payload for a price-increase renewal. Sandbox billing will not fire on cue. */
export function demoRenewalWebhook(subscription: ManagedSubscription, proposedAmount: number) {
  return {
    id: id("WH"),
    event_type: "BILLING.SUBSCRIPTION.UPDATED",
    resource_type: "subscription",
    summary: `Demo replay: ${subscription.plan_name} renewed at ${proposedAmount}`,
    resource: {
      id: subscription.paypal_subscription_id || subscription.subscription_id,
      custom_id: subscription.subscription_id,
      billing_info: {
        last_payment: { amount: { currency_code: subscription.currency, value: proposedAmount.toFixed(2) } },
        outstanding_balance: { currency_code: subscription.currency, value: "0.00" },
      },
    },
  };
}

export function seedSuggestedSubscription(store: StoreData, mandate?: Mandate): ManagedSubscription {
  const existing = store.subscriptions.find((s) => s.merchant_id === "merchant_evil" || s.plan_name === "ShadowStream monthly");
  if (existing) return existing;
  const sub: ManagedSubscription = {
    subscription_id: id("sub"),
    merchant_id: "merchant_clouddraw",
    merchant_name: "ShadowStream (detected, unconfirmed)",
    plan_name: "ShadowStream monthly",
    amount: 15,
    currency: "USD",
    interval: "monthly",
    status: "suggested",
    lifecycle: "suggested",
    bill_type: "subscription",
    expected_amount_min: 15,
    expected_amount_max: 15,
    price_history: [],
    paypal_subscription_id: "MOCK-SUB-SHADOWSTREAM",
    mandate_id: mandate?.mandate_id,
    created_via: "moneymate_mesh",
    next_billing_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    notes: "Detected recurring charge the user has not confirmed. Suggested subscriptions cannot renew until a human activates them.",
    created_at: nowIso(),
  };
  store.subscriptions.push(sub);
  appendEvent(store, "subscription.suggested", "A new recurring charge was detected and parked as suggested until you confirm it.", {
    subscription_id: sub.subscription_id,
    amount: sub.amount,
  });
  return sub;
}

export function confirmSuggestedSubscription(store: StoreData, subscriptionId: string) {
  const sub = store.subscriptions.find((s) => s.subscription_id === subscriptionId);
  if (!sub) throw new Error("Subscription not found");
  if (lifecycleOf(sub) !== "suggested") throw new Error("Only suggested subscriptions can be confirmed");
  sub.lifecycle = "active";
  sub.status = "active";
  appendEvent(store, "subscription.confirmed", `You confirmed ${sub.plan_name}.`, { subscription_id: sub.subscription_id });
  return sub;
}
