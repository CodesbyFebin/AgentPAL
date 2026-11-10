import { describe, expect, it } from "vitest";
import { SEED_MERCHANTS } from "@/lib/catalog";
import { seedFinance } from "@/lib/finance-seed";
import { applyApprovedRenewal, cancelManagedSubscription, evaluateRenewal, seedDemoSubscriptions, seedSuggestedSubscription } from "@/lib/subscriptions";
import type { Mandate, StoreData } from "@/lib/types";

function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    mandate_id: "mand_subs",
    goal_id: "goal_subs",
    title: "Subscription guardian $30",
    max_total_spend: 30,
    auto_approve_limit: 30,
    per_tx_limit: 30,
    approval_threshold: 30,
    approved_merchants: ["merchant_clouddraw", "merchant_logsense", "merchant_stackmail"],
    allowed_categories: ["software"],
    allow_recurring: true,
    minimum_balance: 0,
    currency: "USD",
    expires_at: "2027-11-10T00:00:00.000Z",
    status: "active",
    signed_at: "2026-11-10T00:00:00.000Z",
    public_key: "test",
    signature: "test",
    ...overrides,
  };
}

function demoStore(m: Mandate = mandate()): StoreData {
  const store: StoreData = {
    goals: [],
    mandates: [m],
    plans: [],
    payments: [],
    verifications: [],
    receipts: [],
    events: [],
    approvals: [],
    merchants: structuredClone(SEED_MERCHANTS),
    contracts: [],
    evidence: [],
    finance: seedFinance(),
    idempotency: [],
    webhook_receipts: [],
    subscriptions: [],
    renewal_reviews: [],
    reservations: [],
    ai_calls: [],
    subscription_price_history: [],
    recurring_rules: [],
    merchant_directory: [],
    categories: [],
    ai_tool_logs: [],
    financial_snapshots: [],
    settings: { kill_switch: false, signing: { publicKeyPem: "pub", privateKeyPem: "PRIV-TEST-KEY" } },
  };
  seedDemoSubscriptions(store, m);
  seedSuggestedSubscription(store, m);
  return store;
}

describe("subscription intelligence and renewal policy", () => {
  it("flags CloudDraw $12 → $16 as REQUIRE_APPROVAL with +33.3%, +$4/mo, +$48/yr, others $18, projected $34, exceeds $4", () => {
    const store = demoStore();
    const cloud = store.subscriptions.find((s) => s.plan_name.includes("CloudDraw"))!;
    const review = evaluateRenewal(store, cloud, 16, new Date("2026-11-10T12:00:00.000Z"));
    expect(review.decision).toBe("REQUIRE_APPROVAL");
    expect(review.intelligence.percent_change).toBe(33.3);
    expect(review.intelligence.monthly_increase).toBe(4);
    expect(review.intelligence.annual_increase).toBe(48);
    expect(review.intelligence.mandate_limit).toBe(30);
    expect(review.intelligence.other_subscriptions_total).toBe(18);
    expect(review.intelligence.projected_total).toBe(34);
    expect(review.intelligence.exceeds_by).toBe(4);
    expect(cloud.amount).toBe(12);
    expect(store.approvals.some((a) => a.kind === "renewal" && a.status === "pending")).toBe(true);
  });

  it("allows a Logsense renewal at the same $10 price within the cap", () => {
    const store = demoStore();
    const logsense = store.subscriptions.find((s) => s.plan_name.includes("Logsense"))!;
    const review = evaluateRenewal(store, logsense, 10, new Date("2026-11-10T12:00:00.000Z"));
    expect(review.decision).toBe("ALLOW");
    expect(review.intelligence.projected_total).toBe(30);
    expect(review.intelligence.exceeds_by).toBeLessThanOrEqual(0);
  });

  it("never lets a suggested subscription renew", () => {
    const store = demoStore();
    const shadow = store.subscriptions.find((s) => s.plan_name.includes("ShadowStream"))!;
    const review = evaluateRenewal(store, shadow, 15, new Date("2026-11-10T12:00:00.000Z"));
    expect(review.decision).toBe("DENY");
    expect(review.reason).toMatch(/suggested/i);
  });

  it("never charges a paused or ended subscription", () => {
    const store = demoStore();
    const stack = store.subscriptions.find((s) => s.plan_name.includes("StackMail"))!;
    stack.status = "paused";
    stack.lifecycle = "paused";
    expect(evaluateRenewal(store, stack, 8).decision).toBe("DENY");
    stack.status = "ended";
    stack.lifecycle = "ended";
    expect(evaluateRenewal(store, stack, 8).decision).toBe("DENY");
    expect(evaluateRenewal(store, stack, 8).reason).toMatch(/ended|paused/i);
  });

  it("denies renewal when the mandate has expired", () => {
    const store = demoStore(mandate({ expires_at: "2026-11-01T00:00:00.000Z" }));
    const cloud = store.subscriptions.find((s) => s.plan_name.includes("CloudDraw"))!;
    const review = evaluateRenewal(store, cloud, 12, new Date("2026-11-10T12:00:00.000Z"));
    expect(review.decision).toBe("DENY");
    expect(review.reason).toMatch(/expired/i);
  });

  it("requires approval for a material increase even when the cap still holds", () => {
    const store = demoStore(mandate({ max_total_spend: 100, per_tx_limit: 100, auto_approve_limit: 100, approval_threshold: 100 }));
    const cloud = store.subscriptions.find((s) => s.plan_name.includes("CloudDraw"))!;
    const review = evaluateRenewal(store, cloud, 14, new Date("2026-11-10T12:00:00.000Z"));
    expect(review.material).toBe(true);
    expect(review.decision).toBe("REQUIRE_APPROVAL");
    expect(review.intelligence.percent_change).toBeCloseTo(16.7, 1);
    expect(review.intelligence.projected_total).toBe(32);
    expect(review.intelligence.exceeds_by).toBeLessThanOrEqual(0);
  });

  it("applies the new price only after a human approves", () => {
    const store = demoStore();
    const cloud = store.subscriptions.find((s) => s.plan_name.includes("CloudDraw"))!;
    const review = evaluateRenewal(store, cloud, 16);
    expect(cloud.amount).toBe(12);
    const applied = applyApprovedRenewal(store, review.approval_id!);
    const approval = store.approvals.find((a) => a.approval_id === review.approval_id)!;
    approval.status = "approved";
    expect(applied.subscription.amount).toBe(16);
  });

  it("cancels through PayPal and verifies status when a renewal is declined", async () => {
    const store = demoStore();
    const cloud = store.subscriptions.find((s) => s.plan_name.includes("CloudDraw"))!;
    evaluateRenewal(store, cloud, 16);
    const cancelled = await cancelManagedSubscription(store, cloud.subscription_id, "Human declined the renewal.");
    expect(cancelled.status).toBe("ended");
    expect(cancelled.paypal_verified_status).toMatch(/CANCEL/i);
    expect(store.events.some((e) => e.type === "subscription.cancelled" && String((e.payload as { verified_status?: string }).verified_status).match(/CANCEL/i))).toBe(true);
  });
});
