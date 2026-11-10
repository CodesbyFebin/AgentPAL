import { appendEvent } from "./events";
import { id, nowIso } from "./ids";
import { formatMoney } from "./money";
import { cancelSubscription, getSubscription } from "./paypal";
import { evaluatePolicy } from "./policy";
import type { ManagedSubscription, Mandate, PriceChange, PriceChangeSource, RenewalReview, StoreData } from "./types";
import { buildRenewalIntelligence, isMaterialShift, lifecycleOf, makePriceChange } from "./subscription-metrics";

export { annualizedDelta, isMaterialShift, lifecycleOf, MATERIAL_PRICE_SHIFT, raisedThisYear } from "./subscription-metrics";

export function recordPriceChange(
  store: StoreData | null,
  sub: ManagedSubscription,
  next: number,
  source: PriceChangeSource,
  at = nowIso(),
): PriceChange {
  const change = makePriceChange(sub.amount, next, source, id("px"), at);
  sub.price_history = [...(sub.price_history || []), change];
  sub.expected_amount_min = Math.min(sub.expected_amount_min ?? sub.amount, next, sub.amount);
  sub.expected_amount_max = Math.max(sub.expected_amount_max ?? sub.amount, next, sub.amount);
  if (store) {
    store.subscription_price_history = store.subscription_price_history || [];
    store.subscription_price_history.push({
      history_id: change.change_id,
      subscription_id: sub.subscription_id,
      old_price: change.previous,
      new_price: change.next,
      changed_at: change.effective_at,
      source: change.source,
      material: change.material,
      currency: sub.currency,
    });
  }
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
  store.recurring_rules = store.recurring_rules || [];
  for (const s of created) {
    store.recurring_rules.push({
      rule_id: id("rule"),
      subscription_id: s.subscription_id,
      frequency: "monthly",
      expected_amount: s.amount,
      expected_amount_min: s.amount,
      expected_amount_max: s.amount,
      category: "software",
      bill_type: "subscription",
    });
  }
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
  now: Date = new Date(),
): RenewalReview {
  const mandate = store.mandates.find((m) => m.mandate_id === subscription.mandate_id) ?? store.mandates.find((m) => m.allow_recurring);
  const priceIncreased = proposedAmount > subscription.amount + 1e-9;
  const others = monthlySubscriptionSpend(store, subscription.subscription_id);
  const mandateLimit = mandate?.max_total_spend ?? SUBSCRIPTION_CAP_USD;
  const intelligence = buildRenewalIntelligence({
    previous: subscription.amount,
    next: proposedAmount,
    mandateLimit,
    otherSubscriptionsTotal: others,
    currency: subscription.currency,
  });
  const life = lifecycleOf(subscription);
  const expired = Boolean(
    mandate && Number.isFinite(new Date(mandate.expires_at).getTime()) && new Date(mandate.expires_at).getTime() <= now.getTime(),
  );

  let decision: RenewalReview["decision"] = "ALLOW";
  let reason = `Renewal of ${subscription.plan_name} at ${formatMoney(proposedAmount, subscription.currency)} keeps monthly software spend at ${formatMoney(intelligence.projected_total, "USD")}, within the ${formatMoney(mandateLimit, "USD")} cap.`;

  if (store.settings.kill_switch) {
    decision = "DENY";
    reason = "Kill switch is on. Renewals are frozen.";
  } else if (life === "suggested") {
    decision = "DENY";
    reason = `${subscription.plan_name} is still suggested (unconfirmed). An unconfirmed subscription cannot renew until a human confirms it.`;
  } else if (life === "paused" || life === "ended") {
    decision = "DENY";
    reason = `${subscription.plan_name} is ${life}. Paused or ended subscriptions are never charged.`;
  } else if (!mandate || mandate.status !== "active" || expired) {
    decision = "DENY";
    reason = expired
      ? `The recurring mandate expired at ${mandate?.expires_at}. Renewals are denied until a new mandate is signed.`
      : "No active recurring mandate covers this subscription.";
  } else if (!mandate.approved_merchants.includes(subscription.merchant_id)) {
    decision = "DENY";
    reason = `${subscription.merchant_name} is not on the subscription mandate allowlist.`;
  } else if (intelligence.projected_total > mandateLimit + 1e-9) {
    decision = "REQUIRE_APPROVAL";
    reason = `A renewal at ${formatMoney(proposedAmount, "USD")} would take monthly software spend to ${formatMoney(intelligence.projected_total, "USD")}, over the ${formatMoney(mandateLimit, "USD")} cap${priceIncreased ? " after a price increase" : ""}. Exceeds mandate by ${formatMoney(intelligence.exceeds_by, "USD")}. A human must approve or we can cancel it.`;
  } else if (priceIncreased && isMaterialShift(subscription.amount, proposedAmount)) {
    decision = "REQUIRE_APPROVAL";
    reason = `${subscription.plan_name} has a material price increase (${formatMoney(subscription.amount, "USD")} → ${formatMoney(proposedAmount, "USD")}, ${intelligence.percent_change > 0 ? "+" : ""}${intelligence.percent_change}%). Material increases require approval.`;
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
        now,
      });
      decision = policy.decision;
      reason = policy.reason;
    }
  }

  const review: RenewalReview = {
    review_id: id("ren"),
    subscription_id: subscription.subscription_id,
    mandate_id: mandate?.mandate_id,
    proposed_amount: proposedAmount,
    previous_amount: subscription.amount,
    price_increased: priceIncreased,
    material: isMaterialShift(subscription.amount, proposedAmount),
    decision,
    reason,
    created_at: nowIso(),
    intelligence,
  };

  if (decision === "REQUIRE_APPROVAL") {
    const approval = {
      approval_id: id("appr"),
      payment_id: "",
      step_id: "",
      goal_id: mandate?.goal_id || "",
      merchant_name: subscription.plan_name,
      amount: proposedAmount,
      currency: subscription.currency,
      reason,
      status: "pending" as const,
      created_at: nowIso(),
      kind: "renewal" as const,
      review_id: review.review_id,
      subscription_id: subscription.subscription_id,
    };
    store.approvals.push(approval);
    review.approval_id = approval.approval_id;
  }

  store.renewal_reviews.push(review);
  if (priceIncreased) recordPriceChange(store, subscription, proposedAmount, "detected");
  if (decision === "ALLOW") {
    subscription.status = "active";
    subscription.lifecycle = "active";
  } else if (decision === "REQUIRE_APPROVAL") {
    subscription.status = "pending_renewal";
  }
  subscription.last_renewal_amount = proposedAmount;
  appendEvent(store, "subscription.renewal_reviewed", `${decision}: ${reason}`, {
    subscription_id: subscription.subscription_id,
    review_id: review.review_id,
    mandate_id: mandate?.mandate_id,
    decision,
    proposed_amount: proposedAmount,
    previous_amount: review.previous_amount,
    intelligence,
  });
  return review;
}

export async function cancelManagedSubscription(store: StoreData, subscriptionId: string, reason: string) {
  const sub = store.subscriptions.find((s) => s.subscription_id === subscriptionId);
  if (!sub) throw new Error("Subscription not found");
  if (lifecycleOf(sub) === "ended") {
    return { ...sub, paypal_verified_status: "CANCELLED", paypal_mode: "already_ended" as const };
  }
  const paypalId = sub.paypal_subscription_id || sub.subscription_id;
  const result = await cancelSubscription(paypalId, reason);
  const verified = await getSubscription(paypalId);
  sub.status = "ended";
  sub.lifecycle = "ended";
  sub.cancelled_at = nowIso();
  sub.cancel_reason = reason;
  appendEvent(
    store,
    "subscription.cancelled",
    `Cancelled ${sub.plan_name} via PayPal Subscriptions API (${result.mode} mode) and verified status ${verified.status}: ${reason}`,
    {
      subscription_id: sub.subscription_id,
      paypal_subscription_id: paypalId,
      mode: result.mode,
      reason,
      verified_status: verified.status,
    },
  );
  return { ...sub, paypal_verified_status: verified.status, paypal_mode: result.mode };
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


/** After a human approves a renewal, the new price takes effect. The amount is not changed at review time. */
export function applyApprovedRenewal(store: StoreData, approvalId: string) {
  const approval = store.approvals.find((a) => a.approval_id === approvalId);
  if (!approval || approval.kind !== "renewal") throw new Error("Renewal approval not found");
  const review = store.renewal_reviews.find((r) => r.review_id === approval.review_id);
  const sub = store.subscriptions.find((s) => s.subscription_id === approval.subscription_id);
  if (!review || !sub) throw new Error("Renewal review or subscription not found");
  sub.amount = review.proposed_amount;
  sub.status = "active";
  sub.lifecycle = "active";
  sub.last_renewal_amount = review.proposed_amount;
  const rule = (store.recurring_rules || []).find((r) => r.subscription_id === sub.subscription_id);
  if (rule) {
    rule.expected_amount = review.proposed_amount;
    rule.expected_amount_max = Math.max(rule.expected_amount_max, review.proposed_amount);
  }
  appendEvent(
    store,
    "subscription.renewal_approved",
    `Human approved the ${sub.plan_name} renewal at ${formatMoney(review.proposed_amount, sub.currency)}. The new price is now in effect.`,
    {
      subscription_id: sub.subscription_id,
      review_id: review.review_id,
      approval_id: approval.approval_id,
      previous_amount: review.previous_amount,
      proposed_amount: review.proposed_amount,
      intelligence: review.intelligence,
    },
  );
  return { approval, review, subscription: sub };
}
