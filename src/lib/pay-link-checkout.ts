import { PIXELFORGE_ID } from "./catalog";
import { createSignedMandate, executeStep } from "./engine";
import { appendEvent } from "./events";
import { LAPTOP_INR } from "./finance-constants";
import { id, nowIso } from "./ids";
import { formatMoney } from "./money";
import {
  createPaymentLink,
  DEMO_QR_DISCLAIMER,
  evaluatePaymentLink,
  syncAllPaymentLinks,
  syncPaymentLinkStatus,
  type PaymentLinkEvaluation,
} from "./pay-links";
import type { Mandate, Payment, PaymentLink, Plan, PlanStep, PolicyDecision, StoreData } from "./types";

function resolveLinkProduct(store: StoreData, link: PaymentLink, mandate: Mandate) {
  const merchantId = link.merchant_id || mandate.approved_merchants[0];
  const merchant = store.merchants.find((m) => m.merchant_id === merchantId);
  if (!merchant) throw new Error("Merchant not found for this payment link");
  const product =
    (link.product_sku ? merchant.products.find((p) => p.sku === link.product_sku) : undefined) || merchant.products[0];
  if (!product) throw new Error("No product is configured on this payment link");
  return { merchant, product };
}

export async function startPaymentFromLink(
  store: StoreData,
  linkId: string,
  amount?: number,
  now = new Date(),
): Promise<{
  payment?: Payment;
  decision?: PolicyDecision;
  approval?: { approval_id: string };
  link?: PaymentLink;
  evaluation: PaymentLinkEvaluation;
}> {
  const found = store.payment_links.find((l) => l.link_id === linkId);
  if (!found) {
    return { evaluation: { ok: false, code: "not_found", message: "Payment link not found." } };
  }

  const mandate = store.mandates.find((m) => m.mandate_id === found.mandate_id);
  // Security: when the link is for a catalog SKU, the server catalog price wins. The client
  // amount is only honoured for open-amount links (no product_sku).
  const catalogPrice = found.product_sku
    ? store.merchants
        .find((m) => m.merchant_id === (found.merchant_id || mandate?.approved_merchants[0]))
        ?.products.find((p) => p.sku === found.product_sku)?.amount
    : undefined;
  const requested = catalogPrice ?? (amount ?? found.amount_cap);
  const evaluation = evaluatePaymentLink(store, found, requested, now);
  if (!evaluation.ok) {
    appendEvent(store, "pay_link.pay_blocked", `Payment via link ${found.link_id} blocked: ${evaluation.message}`, {
      link_id: found.link_id,
      mandate_id: found.mandate_id,
      amount: requested,
      code: evaluation.code,
    });
    return { link: found, evaluation };
  }
  if (!mandate) {
    return {
      link: found,
      evaluation: {
        ok: false,
        code: "mandate_inactive",
        message: "The mandate behind this payment link is not active.",
        link: found,
      },
    };
  }

  const { merchant, product } = resolveLinkProduct(store, found, mandate);
  const step: PlanStep = {
    step_id: id("step"),
    action: "pay_link_checkout",
    merchant_id: merchant.merchant_id,
    merchant_name: merchant.name,
    category: product.category,
    amount: requested,
    currency: found.currency,
    rail: "paypal_sandbox",
    approval_required: requested > (mandate.per_tx_limit ?? mandate.auto_approve_limit),
    rationale: `Checkout requested through signed payment link ${found.link_id}. AgentPaL Guard still evaluates the mandate.`,
    product_sku: product.sku,
    recurring: product.recurring,
  };
  const plan: Plan = {
    plan_id: id("plan"),
    goal_id: mandate.goal_id,
    mandate_id: mandate.mandate_id,
    steps: [step],
    planner: "offline",
    status: "approved",
    created_at: nowIso(),
  };
  store.plans.push(plan);

  const execution = await executeStep(store, plan, step);
  if (execution.payment) {
    execution.payment.payment_link_id = found.link_id;
    found.payments.push(execution.payment.payment_id);
    found.use_count += 1;
    syncPaymentLinkStatus(store, found, now);
    appendEvent(
      store,
      "pay_link.checkout_started",
      `Payment ${execution.payment.payment_id} started from link ${found.link_id} after policy ${execution.decision.decision}`,
      {
        link_id: found.link_id,
        mandate_id: found.mandate_id,
        payment_id: execution.payment.payment_id,
        amount: requested,
        decision: execution.decision.decision,
      },
    );
  } else {
    appendEvent(
      store,
      "pay_link.pay_blocked",
      `Payment via link ${found.link_id} did not start: ${execution.decision.reason}`,
      {
        link_id: found.link_id,
        mandate_id: found.mandate_id,
        amount: requested,
        decision: execution.decision.decision,
        reason: execution.decision.reason,
      },
    );
  }

  return {
    payment: execution.payment,
    decision: execution.decision,
    approval: execution.approval ? { approval_id: execution.approval.approval_id } : undefined,
    link: found,
    evaluation,
  };
}

export function ensureLaptopPayLink(store: StoreData): PaymentLink {
  syncAllPaymentLinks(store);
  const existing = store.payment_links.find(
    (l) =>
      l.status === "active" &&
      l.product_sku === "nova_14_65000" &&
      l.amount_cap === LAPTOP_INR &&
      l.currency === "INR",
  );
  if (existing) return existing;

  let mandate: Mandate | undefined = store.mandates.find(
    (m) =>
      m.status === "active" &&
      m.currency === "INR" &&
      m.approved_merchants.includes(PIXELFORGE_ID) &&
      m.allowed_categories.includes("electronics") &&
      (m.title || "").toLowerCase().includes("laptop"),
  );

  if (!mandate) {
    const goal = {
      goal_id: id("goal"),
      user_id: store.finance?.profile.user_id || "usr_demo",
      objective: "Buy NovaBook 14 laptop",
      budget: LAPTOP_INR,
      currency: "INR" as const,
      created_at: nowIso(),
    };
    store.goals.push(goal);
    mandate = createSignedMandate(store, {
      goal_id: goal.goal_id,
      title: "Laptop scan-to-pay (demo)",
      max_total_spend: LAPTOP_INR,
      per_tx_limit: LAPTOP_INR,
      approved_merchants: [PIXELFORGE_ID],
      allowed_categories: ["electronics"],
      allow_recurring: false,
      minimum_balance: 0,
      currency: "INR",
    });
  }

  return createPaymentLink(store, {
    mandate_id: mandate.mandate_id,
    amount_cap: LAPTOP_INR,
    currency: "INR",
    use_type: "single",
    merchant_id: PIXELFORGE_ID,
    product_sku: "nova_14_65000",
    description: `Scan-to-pay request for the NovaBook 14 laptop (${formatMoney(LAPTOP_INR, "INR")}). ${DEMO_QR_DISCLAIMER}.`,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
}
