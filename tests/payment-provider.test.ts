import { afterEach, describe, expect, it } from "vitest";
import {
  _setBraintreeGatewayForTests,
  braintreeSaleCallCount,
  resetBraintreeSaleCallCount,
  type BraintreeGatewayLike,
  type BraintreeTransactionView,
} from "@/lib/braintree";
import { executeStep, policyForStep } from "@/lib/engine";
import { checkoutRail, paymentMode } from "@/lib/payment-mode";
import { amountsMatch } from "@/lib/payment-provider";
import { runBuySafelyScenario, runMaliciousScenario } from "@/lib/scenarios";
import { resetStore, updateStore } from "@/lib/store";
import type { Plan, PlanStep } from "@/lib/types";

const KEYS = [
  "BRAINTREE_MERCHANT_ID",
  "BRAINTREE_PUBLIC_KEY",
  "BRAINTREE_PRIVATE_KEY",
  "BRAINTREE_ENV",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
] as const;

const saved: Record<string, string | undefined> = {};

function snapshotEnv() {
  for (const k of KEYS) saved[k] = process.env[k];
}

function restoreEnv() {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _setBraintreeGatewayForTests(null);
  resetBraintreeSaleCallCount();
}

snapshotEnv();
afterEach(restoreEnv);

function plantBraintree() {
  process.env.BRAINTREE_MERCHANT_ID = "test-merchant";
  process.env.BRAINTREE_PUBLIC_KEY = "test-public";
  process.env.BRAINTREE_PRIVATE_KEY = "test-private-key-not-real";
  process.env.BRAINTREE_ENV = "sandbox";
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
}

function memoryGateway(overrides: Partial<{ amount: string; currency: string }> = {}) {
  const txs = new Map<string, BraintreeTransactionView>();
  let n = 0;
  const gateway: BraintreeGatewayLike = {
    clientToken: {
      generate: async () => ({ clientToken: "fake-client-token", success: true }),
    },
    transaction: {
      sale: async (req) => {
        n += 1;
        const tx: BraintreeTransactionView = {
          id: `btx_${n}`,
          status: "authorized",
          amount: overrides.amount ?? req.amount,
          currencyIsoCode: overrides.currency ?? "USD",
        };
        txs.set(tx.id, tx);
        return { success: true, transaction: tx };
      },
      submitForSettlement: async (id) => {
        const tx = txs.get(id);
        if (!tx) return { success: false, message: "not found" };
        const next = { ...tx, status: "submitted_for_settlement" };
        txs.set(id, next);
        return { success: true, transaction: next };
      },
      void: async (id) => {
        const tx = txs.get(id);
        if (!tx) return { success: false, message: "not found" };
        const next = { ...tx, status: "voided" };
        txs.set(id, next);
        return { success: true, transaction: next };
      },
      refund: async (id) => {
        const tx = txs.get(id);
        if (!tx) return { success: false, message: "not found" };
        const next = { ...tx, status: "refunded", id: `ref_${id}` };
        return { success: true, transaction: next };
      },
      find: async (id) => {
        const tx = txs.get(id);
        if (!tx) throw new Error("not found");
        return tx;
      },
    },
  };
  return { gateway, txs };
}

describe("paymentMode precedence", () => {
  it("prefers Braintree, then PayPal REST, then mock", () => {
    delete process.env.BRAINTREE_MERCHANT_ID;
    delete process.env.BRAINTREE_PUBLIC_KEY;
    delete process.env.BRAINTREE_PRIVATE_KEY;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    expect(paymentMode()).toBe("mock");
    expect(checkoutRail()).toBe("paypal_sandbox");

    process.env.PAYPAL_CLIENT_ID = "A" + "x".repeat(20);
    process.env.PAYPAL_CLIENT_SECRET = "secret";
    expect(paymentMode()).toBe("paypal-sandbox");

    plantBraintree();
    expect(paymentMode()).toBe("braintree-sandbox");
    expect(checkoutRail()).toBe("braintree_sandbox");
  });
});

describe("policy still gates Braintree", () => {
  it("DENY on a malicious merchant creates zero Braintree transactions", async () => {
    plantBraintree();
    const { gateway } = memoryGateway();
    _setBraintreeGatewayForTests(gateway);
    resetBraintreeSaleCallCount();
    const result = await runMaliciousScenario();
    expect(result.injection.decision.decision).toBe("DENY");
    expect(result.processor_transactions_created).toBe(0);
    expect(result.braintree_transactions_created).toBe(0);
    expect(braintreeSaleCallCount()).toBe(0);
    expect(result.after_kill_switch.decision).toBe("DENY");
  });

  it("kill switch blocks a later ALLOW-looking purchase with zero sale calls", async () => {
    plantBraintree();
    const { gateway } = memoryGateway();
    _setBraintreeGatewayForTests(gateway);
    resetStore();
    await updateStore(async (store) => {
      store.settings.kill_switch = true;
      const mandate = store.mandates[0];
      const merchant = store.merchants.find((m) => m.merchant_id === "merchant_001")!;
      const product = merchant.products[0];
      const step: PlanStep = {
        step_id: "step_kill",
        action: "purchase",
        merchant_id: merchant.merchant_id,
        merchant_name: merchant.name,
        category: product.category,
        amount: product.amount,
        currency: product.currency,
        rail: "braintree_sandbox",
        approval_required: false,
        rationale: "should be denied by kill switch",
        product_sku: product.sku,
        recurring: false,
      };
      const dummyMandate = store.mandates[0] ?? {
        mandate_id: "mand_none",
        goal_id: "goal_none",
        max_total_spend: 50,
        auto_approve_limit: 10,
        per_tx_limit: 10,
        approval_threshold: 10,
        approved_merchants: [merchant.merchant_id],
        allowed_categories: [product.category],
        allow_recurring: false,
        minimum_balance: 0,
        currency: "USD" as const,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        status: "active" as const,
        signed_at: new Date().toISOString(),
        public_key: "x",
        signature: "x",
      };
      if (!store.mandates.includes(dummyMandate)) store.mandates.push(dummyMandate);
      const decision = policyForStep(store, dummyMandate, step);
      expect(decision.decision).toBe("DENY");
      const plan: Plan = {
        plan_id: "plan_kill",
        goal_id: dummyMandate.goal_id,
        mandate_id: dummyMandate.mandate_id,
        steps: [step],
        planner: "offline",
        status: "approved",
        created_at: new Date().toISOString(),
      };
      const exec = await executeStep(store, plan, step);
      expect(exec.decision.decision).toBe("DENY");
      expect(exec.payment).toBeUndefined();
    });
    expect(braintreeSaleCallCount()).toBe(0);
  });

  it("authorizes then captures an ALLOW payment through the injected gateway", async () => {
    plantBraintree();
    const { gateway, txs } = memoryGateway();
    _setBraintreeGatewayForTests(gateway);
    const demo = await runBuySafelyScenario();
    expect(demo.payment).toBe("braintree-sandbox");
    const allowed = demo.executions.find((e) => e.decision.decision === "ALLOW");
    expect(allowed?.payment?.status).toBe("awaiting_buyer");
    expect(allowed?.payment?.rail).toBe("braintree_sandbox");
    expect(allowed?.payment?.braintree?.transaction_id).toBeUndefined();
    expect(braintreeSaleCallCount()).toBe(0);

    const { completePaymentAfterBuyer } = await import("@/lib/engine");
    const payment = await updateStore((store) =>
      completePaymentAfterBuyer(store, allowed!.payment!.payment_id, { nonce: "fake-valid-nonce" }),
    );
    expect(braintreeSaleCallCount()).toBe(1);
    expect(payment.status).toBe("captured");
    expect(payment.braintree?.authorization_id).toBeTruthy();
    expect(payment.braintree?.capture_id).toBe(payment.braintree?.authorization_id);
    expect(payment.braintree?.status).toBe("submitted_for_settlement");
    const stored = txs.get(payment.braintree!.transaction_id!);
    expect(stored?.status).toBe("submitted_for_settlement");
  });

  it("voids when the authorized amount does not match the reservation", async () => {
    plantBraintree();
    const { gateway, txs } = memoryGateway({ amount: "99.00" });
    _setBraintreeGatewayForTests(gateway);
    const demo = await runBuySafelyScenario();
    const allowed = demo.executions.find((e) => e.decision.decision === "ALLOW");
    const { completePaymentAfterBuyer } = await import("@/lib/engine");
    await expect(
      updateStore((store) =>
        completePaymentAfterBuyer(store, allowed!.payment!.payment_id, { nonce: "fake-valid-nonce" }),
      ),
    ).rejects.toThrow(/does not match the reserved mandate amount/);
    const voided = [...txs.values()].find((t) => t.status === "voided");
    expect(voided).toBeTruthy();
  });
});

describe("amountsMatch", () => {
  it("compares USD amounts to the cent", () => {
    expect(amountsMatch(8, 8, "USD", "USD")).toBe(true);
    expect(amountsMatch(8.0, 8, "usd", "USD")).toBe(true);
    expect(amountsMatch(8.01, 8, "USD", "USD")).toBe(false);
    expect(amountsMatch(8, 8, "EUR", "USD")).toBe(false);
  });
});
