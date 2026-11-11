import { DEMO_GOAL_TEXT, SEED_MERCHANTS } from "./catalog";
import { applyCapturedPurchase } from "./finance-apply";
import { assessFromFinance } from "./finance-engine";
import { findOpenIntent, intentKey, reserveSpend } from "./reservations";
import { formatMoney, fxBreakdown, toUsd } from "./money";
import { signPayload, verifyPayload } from "./crypto";
import { draftEvidence } from "./evidence";
import { appendEvent } from "./events";
import { id, nowIso } from "./ids";
import { checkoutRail, paymentMode } from "./payment-mode";
import { disablePaymentLinksForMandate, publicPaymentLinkView, syncAllPaymentLinks } from "./pay-links";
import { settlementTimelinesFor } from "./settlement";
import {
  amountsMatch,
  authorizeReservedPayment,
  bindingMismatch,
  captureReservedPayment,
  refundReservedPayment,
  startPaymentCheckout,
  voidReservedPayment,
} from "./payment-provider";
import { generatePlan } from "./planner";
import { evaluatePolicy } from "./policy";
import { buildReceipt, mandateSigningPayload } from "./receipts";
import {
  capturedSpend,
  paypalMode,
  plannerMode,
  remainingBudget,
  resetStore,
  updateStore,
} from "./store";
import { contractForStep, deliverArtifact, verifyArtifact } from "./verify";
import { settleSimulatedX402 } from "./x402";
import { spaceForMandate } from "./spaces";
import type {
  Approval,
  Goal,
  Mandate,
  Payment,
  Plan,
  PlanStep,
  PolicyDecision,
  StoreData,
} from "./types";

function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function createSignedMandate(
  store: StoreData,
  input: {
    goal_id: string;
    title?: string;
    max_total_spend: number;
    auto_approve_limit?: number;
    per_tx_limit?: number;
    approval_threshold?: number;
    approved_merchants: string[];
    allowed_categories: string[];
    allow_recurring?: boolean;
    minimum_balance?: number;
    currency?: Mandate["currency"];
    expires_at?: string;
    space?: Mandate["space"];
  },
): Mandate {
  const expires_at =
    input.expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const per_tx_limit = input.per_tx_limit ?? input.auto_approve_limit ?? 10;
  const unsigned: Omit<Mandate, "signature"> = {
    mandate_id: id("mand"),
    goal_id: input.goal_id,
    title: input.title,
    max_total_spend: input.max_total_spend,
    auto_approve_limit: per_tx_limit,
    per_tx_limit,
    approval_threshold: input.approval_threshold ?? per_tx_limit,
    approved_merchants: input.approved_merchants,
    allowed_categories: input.allowed_categories,
    allow_recurring: Boolean(input.allow_recurring),
    minimum_balance: input.minimum_balance ?? 0,
    currency: input.currency ?? "USD",
    expires_at,
    status: "active",
    signed_at: nowIso(),
    public_key: store.settings.signing.publicKeyPem,
    space: input.space || spaceForMandate({ title: input.title, allowed_categories: input.allowed_categories }),
  };
  const signature = signPayload(mandateSigningPayload(unsigned), store.settings.signing.privateKeyPem);
  const mandate: Mandate = { ...unsigned, signature };
  store.mandates.push(mandate);
  appendEvent(store, "mandate.signed", `Ed25519-signed mandate ${mandate.mandate_id} created`, {
    goal_id: mandate.goal_id,
    mandate_id: mandate.mandate_id,
    title: mandate.title,
    max_total_spend: mandate.max_total_spend,
    per_tx_limit: mandate.per_tx_limit,
  });
  return mandate;
}

/**
 * Re-verifies a mandate's Ed25519 signature against THIS server's signing key (never the key embedded
 * in the mandate). Lifecycle fields (status, revoked_at) are normalised to their values at signing time
 * so a revoked mandate still verifies; revocation itself is enforced by policy.
 */
export function verifyMandateSignature(store: StoreData, mandate: Mandate): boolean {
  try {
    if (!mandate?.signature || mandate.public_key !== store.settings.signing.publicKeyPem) return false;
    const { revoked_at: _r, ...rest } = mandate;
    void _r;
    const payload = mandateSigningPayload({ ...rest, status: "active" } as Omit<Mandate, "signature">);
    return verifyPayload(payload, store.settings.signing.publicKeyPem, mandate.signature);
  } catch {
    return false;
  }
}

export function revokeMandate(store: StoreData, mandateId: string): Mandate {
  const mandate = store.mandates.find((m) => m.mandate_id === mandateId);
  if (!mandate) throw new Error("Mandate not found");
  mandate.status = "revoked";
  mandate.revoked_at = nowIso();
  appendEvent(store, "mandate.revoked", `Mandate ${mandate.mandate_id} revoked`, {
    goal_id: mandate.goal_id,
    mandate_id: mandate.mandate_id,
  });
  disablePaymentLinksForMandate(store, mandate.mandate_id);
  return mandate;
}

export function policyForStep(
  store: StoreData,
  mandate: Mandate,
  step: PlanStep,
): PolicyDecision {
  if (!verifyMandateSignature(store, mandate)) {
    return {
      decision_id: id("pol"),
      step_id: step.step_id,
      merchant_id: step.merchant_id,
      amount: step.amount,
      decision: "DENY",
      reason: `Mandate ${mandate.mandate_id} failed Ed25519 signature re-verification; it may have been altered. Nothing was paid.`,
      checks: [{ code: "mandate_signature", passed: false, detail: "Signature does not match this server's signing key." }],
      created_at: nowIso(),
    };
  }
  const merchant = store.merchants.find((m) => m.merchant_id === step.merchant_id);
  if (!merchant) {
    return {
      decision_id: id("pol"),
      step_id: step.step_id,
      merchant_id: step.merchant_id,
      amount: step.amount,
      decision: "DENY",
      reason: `Unknown merchant ${step.merchant_id}.`,
      checks: [{ code: "merchant", passed: false, detail: "Merchant not in catalog." }],
      created_at: nowIso(),
    };
  }
  const mandateSpend = mandate.max_total_spend - remainingBudget(store, mandate.mandate_id);
  let projectedBalance: number | undefined;
  if (mandate.currency === "INR" && store.finance) {
    const assessment = assessFromFinance(store.finance, 0);
    projectedBalance = assessment.projected_eom_balance_without_purchase;
  }
  const decision = evaluatePolicy({
    mandate,
    merchant,
    amount: step.amount,
    currency: step.currency,
    category: step.category,
    recurring: step.recurring,
    mandateSpend,
    projectedBalance,
    remainingBudget: remainingBudget(store, mandate.mandate_id),
    killSwitch: store.settings.kill_switch,
  });
  decision.step_id = step.step_id;
  return decision;
}

function newPayment(opts: {
  plan: Plan;
  step: PlanStep;
  status: Payment["status"];
  approval: Payment["approval"];
}): Payment {
  const now = nowIso();
  return {
    payment_id: id("pay"),
    plan_id: opts.plan.plan_id,
    step_id: opts.step.step_id,
    goal_id: opts.plan.goal_id,
    mandate_id: opts.plan.mandate_id,
    merchant_id: opts.step.merchant_id,
    merchant_name: opts.step.merchant_name,
    rail: opts.step.rail === "x402_usdc" ? "x402_usdc" : checkoutRail(),
    amount: opts.step.amount,
    currency: opts.step.currency,
    status: opts.status,
    approval: opts.approval,
    created_at: now,
    updated_at: now,
  };
}

export async function executeStep(
  store: StoreData,
  plan: Plan,
  step: PlanStep,
  opts: { afterHumanApproval?: boolean } = {},
): Promise<{
  payment?: Payment;
  approval?: Approval;
  decision: PolicyDecision;
}> {
  const mandate = store.mandates.find((m) => m.mandate_id === plan.mandate_id);
  if (!mandate) throw new Error("Mandate not found");

  const decision = policyForStep(store, mandate, step);
  appendEvent(
    store,
    "policy.decision",
    `${decision.decision.toUpperCase()}: ${decision.reason}`,
    {
      goal_id: plan.goal_id,
      step_id: step.step_id,
      merchant_id: step.merchant_id,
      amount: step.amount,
      decision: decision.decision,
      reason: decision.reason,
      checks: decision.checks,
    },
  );

  if (decision.decision === "DENY") {
    return { decision };
  }

  const key = intentKey({
    mandate_id: plan.mandate_id,
    merchant_id: step.merchant_id,
    sku: step.product_sku,
    amount: step.amount,
    currency: step.currency,
  });
  if (!opts.afterHumanApproval) {
    const existing = findOpenIntent(store, key);
    if (existing.payment) {
      appendEvent(store, "payment.deduped", `Duplicate intent ${key} reused payment ${existing.payment.payment_id}`, {
        goal_id: plan.goal_id,
        payment_id: existing.payment.payment_id,
        intent_key: key,
      });
      return { payment: existing.payment, decision, approval: store.approvals.find((a) => a.payment_id === existing.payment!.payment_id && a.status === "pending") };
    }
  }

  if (decision.decision === "REQUIRE_APPROVAL" && !opts.afterHumanApproval) {
    const payment = newPayment({
      plan,
      step,
      status: "awaiting_approval",
      approval: "human",
    });
    payment.idempotency_key = key;
    store.payments.push(payment);
    const reserved = reserveSpend(store, {
      mandate_id: plan.mandate_id,
      intent_key: key,
      amount: step.amount,
      currency: step.currency,
      payment_id: payment.payment_id,
    });
    if (reserved.deduped) {
      /* reservation already existed */
    }
    const approval: Approval = {
      approval_id: id("appr"),
      payment_id: payment.payment_id,
      step_id: step.step_id,
      goal_id: plan.goal_id,
      merchant_name: step.merchant_name,
      amount: step.amount,
      currency: step.currency,
      reason: decision.reason,
      status: "pending",
      created_at: nowIso(),
    };
    store.approvals.push(approval);
    appendEvent(
      store,
      "approval.requested",
      `Human approval requested for ${step.merchant_name} (${formatMoney(step.amount, step.currency)})`,
      {
        goal_id: plan.goal_id,
        payment_id: payment.payment_id,
        approval_id: approval.approval_id,
        reason: decision.reason,
      },
    );
    return { payment, approval, decision };
  }

  const payment = store.payments.find((p) => p.step_id === step.step_id && p.plan_id === plan.plan_id) ??
    newPayment({
      plan,
      step,
      status: "proposed",
      approval: opts.afterHumanApproval ? "human" : "auto",
    });
  if (!store.payments.includes(payment)) store.payments.push(payment);
  payment.idempotency_key = payment.idempotency_key || key;
  if (!store.reservations.some((r) => r.payment_id === payment.payment_id && r.status === "reserved")) {
    reserveSpend(store, {
      mandate_id: plan.mandate_id,
      intent_key: key,
      amount: step.amount,
      currency: step.currency,
      payment_id: payment.payment_id,
    });
  }

  if (step.rail === "x402_usdc") {
    const x402 = settleSimulatedX402(step.amount);
    payment.rail = "x402_usdc";
    payment.x402 = { simulated: true, transfer_id: x402.transfer_id };
    payment.status = "settled";
    payment.updated_at = nowIso();
    appendEvent(
      store,
      "payment.x402.simulated",
      `Simulated x402/USDC payment of $${step.amount.toFixed(2)} to ${step.merchant_name} settled (${x402.transfer_id})`,
      {
        goal_id: plan.goal_id,
        payment_id: payment.payment_id,
        transfer_id: x402.transfer_id,
        amount: step.amount,
        simulated: true,
      },
    );
    fulfillAndMaybeSettle(store, payment, step);
    return { payment, decision };
  }

  const settlementCurrency = "USD";
  const settlementAmount = toUsd(step.amount, step.currency);
  const fx = step.currency === "INR" ? fxBreakdown(step.amount) : undefined;
  const session = await startPaymentCheckout({
    amount: settlementAmount,
    currency: settlementCurrency,
    description: `${step.action} at ${step.merchant_name} (agent on behalf of user)`,
    customId: payment.payment_id,
    requestId: payment.idempotency_key || payment.payment_id,
    returnUrl: `${appUrl()}/paypal/return?payment_id=${encodeURIComponent(payment.payment_id)}`,
    cancelUrl: `${appUrl()}/paypal/cancel?payment_id=${encodeURIComponent(payment.payment_id)}`,
  });
  payment.rail = session.provider === "braintree" ? "braintree_sandbox" : "paypal_sandbox";
  const settlement = {
    settlement_currency: "USD" as const,
    settlement_amount: settlementAmount,
    fx_rate: fx?.rate,
    fx_label: fx?.label,
  };
  if (session.provider === "braintree") {
    payment.braintree = {
      mode: session.mode,
      order_id: session.order_id,
      ...settlement,
    };
  } else {
    payment.paypal = {
      mode: session.mode,
      order_id: session.order_id,
      approve_url: session.approve_url,
      ...settlement,
    };
  }
  payment.status = "awaiting_buyer";
  payment.updated_at = nowIso();
  const providerLabel = session.provider === "braintree" ? "Braintree" : session.provider === "mock" ? "Mock PayPal" : "PayPal";
  appendEvent(
    store,
    session.provider === "braintree" ? "payment.braintree.checkout_started" : "payment.paypal.order_created",
    `${providerLabel} ${session.mode} checkout ${session.order_id} prepared (authorize, then capture after verification) for ${formatMoney(step.amount, step.currency)}${fx ? ` (settled as ${formatMoney(settlementAmount, "USD")} at the labeled demo FX rate)` : ""}. No capture has occurred.`,
    {
      goal_id: plan.goal_id,
      payment_id: payment.payment_id,
      order_id: session.order_id,
      mode: session.mode,
      provider: session.provider,
      approve_url: session.approve_url,
    },
  );
  return { payment, decision };
}

export function fulfillAndMaybeSettle(store: StoreData, payment: Payment, step: PlanStep) {
  const merchant = store.merchants.find((m) => m.merchant_id === payment.merchant_id);
  if (!merchant) throw new Error("Merchant not found");
  let contract = store.contracts.find((c) => c.step_id === step.step_id);
  if (!contract) {
    contract = contractForStep(payment.goal_id, step);
    store.contracts.push(contract);
  }
  payment.artifact = deliverArtifact(merchant, step);
  payment.updated_at = nowIso();
  appendEvent(store, "delivery.received", `Artifact received from ${payment.merchant_name}`, {
    goal_id: payment.goal_id,
    payment_id: payment.payment_id,
    artifact: payment.artifact,
  });

  const verification = verifyArtifact(contract, payment.artifact);
  verification.payment_id = payment.payment_id;
  store.verifications.push(verification);
  appendEvent(
    store,
    "verification.completed",
    `Outcome verification ${verification.status} for ${payment.merchant_name}`,
    {
      goal_id: payment.goal_id,
      payment_id: payment.payment_id,
      status: verification.status,
      checks: verification.checks,
    },
  );
  return verification;
}

export async function completePaymentAfterBuyer(
  store: StoreData,
  paymentId: string,
  opts: { orderId?: string; nonce?: string } = {},
) {
  const payment = store.payments.find((p) => p.payment_id === paymentId);
  if (!payment) throw new Error("Payment not found");
  const plan = store.plans.find((p) => p.plan_id === payment.plan_id);
  const step = plan?.steps.find((s) => s.step_id === payment.step_id);
  if (!plan || !step) throw new Error("Plan step not found");

  if (store.settings.kill_switch) {
    throw new Error("Kill switch is on. AgentPaL Guard refuses to authorize any payment until a human turns it off.");
  }
  if (payment.status !== "awaiting_buyer") {
    throw new Error(`Payment is ${payment.status}, not awaiting buyer approval`);
  }

  const expectedAmount =
    payment.braintree?.settlement_amount ??
    payment.paypal?.settlement_amount ??
    toUsd(payment.amount, payment.currency);
  const expectedCurrency = "USD";

  const auth = await authorizeReservedPayment({
    payment,
    nonce: opts.nonce,
    orderId: opts.orderId,
    expectedAmount,
    expectedCurrency,
  });

  const binding = bindingMismatch(auth, payment.payment_id);
  if (binding || !amountsMatch(auth.amount, expectedAmount, auth.currency, expectedCurrency)) {
    try {
      await voidReservedPayment(auth.authorization_id, payment.rail);
    } catch {
      /* still fail closed */
    }
    payment.status = "failed";
    payment.updated_at = nowIso();
    if (payment.rail === "braintree_sandbox") {
      payment.braintree = {
        ...(payment.braintree || { mode: "sandbox" }),
        transaction_id: auth.authorization_id,
        authorization_id: auth.authorization_id,
        status: "voided_amount_mismatch",
      };
    }
    appendEvent(
      store,
      "payment.authorization.mismatch",
      binding
        ? `Authorization ${auth.authorization_id} voided by AgentPaL Guard: ${binding}`
        : `Authorization ${auth.authorization_id} voided because ${auth.currency} ${auth.amount} did not match the reserved ${expectedCurrency} ${expectedAmount.toFixed(2)}`,
      {
        goal_id: payment.goal_id,
        payment_id: payment.payment_id,
        authorization_id: auth.authorization_id,
        expected_amount: expectedAmount,
        actual_amount: auth.amount,
        binding_mismatch: binding || undefined,
      },
    );
    throw new Error(
      binding
        ? `Authorization does not match the reserved payment: ${binding}`
        : `Authorized amount ${auth.currency} ${auth.amount} does not match the reserved mandate amount ${expectedCurrency} ${expectedAmount.toFixed(2)}`,
    );
  }

  if (payment.rail === "braintree_sandbox") {
    payment.braintree = {
      ...(payment.braintree || { mode: auth.mode }),
      mode: auth.mode,
      transaction_id: auth.authorization_id,
      authorization_id: auth.authorization_id,
      status: auth.status,
      settlement_currency: "USD",
      settlement_amount: expectedAmount,
    };
  } else {
    payment.paypal = {
      ...(payment.paypal || { mode: auth.mode }),
      mode: auth.mode,
      order_id: opts.orderId || payment.paypal?.order_id,
      authorization_id: auth.authorization_id,
    };
  }
  payment.status = "authorized";
  payment.updated_at = nowIso();
  const authLabel = payment.rail === "braintree_sandbox" ? "Braintree" : auth.mode === "mock" ? "Mock PayPal" : "PayPal";
  appendEvent(
    store,
    payment.rail === "braintree_sandbox" ? "payment.braintree.authorized" : "payment.paypal.authorized",
    `${authLabel} authorization ${auth.authorization_id} held (not captured) for ${payment.merchant_name}`,
    {
      goal_id: payment.goal_id,
      payment_id: payment.payment_id,
      authorization_id: auth.authorization_id,
      mode: auth.mode,
      provider: auth.provider,
    },
  );

  const verification = fulfillAndMaybeSettle(store, payment, step);
  if (verification.status === "passed") {
    const cap = await captureReservedPayment(auth.authorization_id, payment.rail, {
      amount: expectedAmount,
      currency: expectedCurrency,
      requestId: `cap-${payment.payment_id}`,
    });
    if (payment.rail === "braintree_sandbox" && payment.braintree) {
      payment.braintree.capture_id = cap.capture_id;
      payment.braintree.status = cap.status || "submitted_for_settlement";
    } else if (payment.paypal) {
      payment.paypal.capture_id = cap.capture_id;
    }
    payment.status = "captured";
    payment.updated_at = nowIso();
    appendEvent(
      store,
      payment.rail === "braintree_sandbox" ? "payment.braintree.captured" : "payment.paypal.captured",
      `${authLabel} capture ${cap.capture_id} after verification passed`,
      {
        goal_id: payment.goal_id,
        payment_id: payment.payment_id,
        capture_id: cap.capture_id,
        mode: cap.mode,
        status: cap.status,
      },
    );
    applyCapturedPurchase(store, payment);
  } else {
    await voidReservedPayment(auth.authorization_id, payment.rail);
    payment.status = "voided";
    payment.updated_at = nowIso();
    if (payment.braintree) payment.braintree.status = "voided";
    appendEvent(
      store,
      payment.rail === "braintree_sandbox" ? "payment.braintree.voided" : "payment.paypal.voided",
      `${authLabel} authorization ${auth.authorization_id} voided because verification failed`,
      {
        goal_id: payment.goal_id,
        payment_id: payment.payment_id,
        authorization_id: auth.authorization_id,
      },
    );
    const evidence = await draftEvidence(payment, verification);
    store.evidence.push(evidence);
    appendEvent(store, "evidence.drafted", `Refund/dispute evidence drafted (${evidence.source})`, {
      goal_id: payment.goal_id,
      payment_id: payment.payment_id,
      evidence_id: evidence.evidence_id,
      source: evidence.source,
    });
  }
  return payment;
}

/** @deprecated Use completePaymentAfterBuyer */
export async function completePaypalAfterBuyer(store: StoreData, paymentId: string, orderId?: string) {
  return completePaymentAfterBuyer(store, paymentId, { orderId });
}

export async function refundPayment(store: StoreData, paymentId: string) {
  const payment = store.payments.find((p) => p.payment_id === paymentId);
  if (!payment) throw new Error("Payment not found");
  if (payment.rail === "x402_usdc") {
    payment.status = "refunded";
    payment.updated_at = nowIso();
    appendEvent(store, "payment.x402.refunded", `Simulated x402 refund for ${payment.payment_id}`, {
      goal_id: payment.goal_id,
      payment_id: payment.payment_id,
      simulated: true,
    });
    return payment;
  }
  const captureId = payment.braintree?.capture_id || payment.paypal?.capture_id;
  if (!captureId) throw new Error("No capture to refund");
  const amount =
    payment.braintree?.settlement_amount ??
    payment.paypal?.settlement_amount ??
    toUsd(payment.amount, payment.currency);
  const currency = payment.braintree?.settlement_currency || payment.paypal?.settlement_currency || "USD";
  const ref = await refundReservedPayment(captureId, payment.rail, amount, currency);
  if (payment.rail === "braintree_sandbox" && payment.braintree) {
    payment.braintree.refund_id = ref.refund_id;
    payment.braintree.status = "refunded";
  } else if (payment.paypal) {
    payment.paypal.refund_id = ref.refund_id;
  }
  payment.status = "refunded";
  payment.updated_at = nowIso();
  const refundLabel = payment.rail === "braintree_sandbox" ? "Braintree" : ref.mode === "mock" ? "Mock PayPal" : "PayPal";
  appendEvent(store, payment.rail === "braintree_sandbox" ? "payment.braintree.refunded" : "payment.paypal.refunded", `${refundLabel} refund ${ref.refund_id} issued`, {
    goal_id: payment.goal_id,
    payment_id: payment.payment_id,
    refund_id: ref.refund_id,
    mode: ref.mode,
  });
  return payment;
}

export async function runDemoScenario() {
  resetStore();
  return updateStore(async (store) => {
    appendEvent(store, "demo.started", "One-click demo scenario started", {
      prompt: DEMO_GOAL_TEXT,
    });

    const goal: Goal = {
      goal_id: id("goal"),
      user_id: "usr_demo",
      objective: DEMO_GOAL_TEXT,
      budget: 50,
      currency: "USD",
      deadline: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: nowIso(),
    };
    store.goals.push(goal);
    appendEvent(store, "goal.created", "Goal captured from natural language", {
      goal_id: goal.goal_id,
      objective: goal.objective,
      budget: goal.budget,
    });

    const mandate = createSignedMandate(store, {
      title: "Demo: Startup tools under $50 (one-click run)",
      goal_id: goal.goal_id,
      max_total_spend: 50,
      auto_approve_limit: 10,
      approved_merchants: ["merchant_001", "merchant_002"],
      allowed_categories: ["api_credits", "domain"],
      expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const plan = await generatePlan(goal, mandate, store.merchants);
    plan.status = "approved";
    store.plans.push(plan);
    for (const skipped of plan.skipped_steps ?? []) {
      appendEvent(store, "plan.step_skipped", skipped.message, { goal_id: goal.goal_id, plan_id: plan.plan_id, ...skipped });
    }
    appendEvent(store, "plan.generated", `Plan ${plan.plan_id} generated by ${plan.planner} planner`, {
      goal_id: goal.goal_id,
      plan_id: plan.plan_id,
      planner: plan.planner,
      model: plan.model,
      steps: plan.steps,
    });
    appendEvent(store, "plan.approved", "Plan approved as part of the one-click demo run", {
      goal_id: goal.goal_id,
      plan_id: plan.plan_id,
    });

    const executions = [];
    for (const step of plan.steps) {
      executions.push(await executeStep(store, plan, step));
    }

    // Always demonstrate the injection merchant being blocked, even if the planner ignored it.
    const evil = store.merchants.find((m) => m.merchant_id === "merchant_evil")!;
    const evilStep: PlanStep = {
      step_id: id("step"),
      action: "purchase_unrestricted_bundle",
      merchant_id: evil.merchant_id,
      merchant_name: evil.name,
      category: "misc",
      amount: 49,
      currency: "USD",
      rail: "paypal_sandbox",
      approval_required: true,
      rationale: "Adversarial catalog item included only to demonstrate the prompt-injection guard.",
      product_sku: evil.products[0].sku,
      recurring: false,
    };
    const injection = await executeStep(store, { ...plan, steps: [...plan.steps, evilStep] }, evilStep);

    return {
      goal,
      mandate,
      mandates: store.mandates,
      plan,
      executions,
      injection,
      planner: plannerMode(),
      paypal: paypalMode(),
      payment: paymentMode(),
    };
  });
}

export function snapshot() {
  return updateStore((store) => {
    const goal = store.goals[store.goals.length - 1] ?? null;
    const mandate = goal ? store.mandates.find((m) => m.goal_id === goal.goal_id) ?? null : [...store.mandates].reverse().find((m) => m.status === "active" && verifyMandateSignature(store, m)) ?? null;
    const plan = goal ? store.plans.find((p) => p.goal_id === goal.goal_id) ?? null : store.plans.at(-1) ?? null;
    syncAllPaymentLinks(store);
    return {
      goal,
      mandate,
      plan,
      payments: store.payments,
      approvals: store.approvals,
      verifications: store.verifications,
      receipts: store.receipts,
      events: store.events,
      merchants: store.merchants.map((m) => ({
        ...m,
        trust_passport: m.trust_passport,
      })),
      contracts: store.contracts,
      evidence: store.evidence,
      settings: {
        kill_switch: store.settings.kill_switch,
        kill_switch_at: store.settings.kill_switch_at,
        public_key: store.settings.signing.publicKeyPem,
      },
      budget: mandate
        ? {
            max: mandate.max_total_spend,
            captured: capturedSpend(store, mandate.mandate_id),
            remaining: remainingBudget(store, mandate.mandate_id),
            auto_approve_limit: mandate.auto_approve_limit,
          }
        : null,
      finance: store.finance,
      idempotency: store.idempotency,
      webhook_receipts: store.webhook_receipts,
      subscriptions: store.subscriptions,
      renewal_reviews: store.renewal_reviews,
      reservations: store.reservations,
      payment_links: store.payment_links.map((l) => publicPaymentLinkView(l)),
      settlement_timelines: settlementTimelinesFor(store.payments, store.verifications, store.events),
      ai_calls: store.ai_calls,
      ai_tool_logs: store.ai_tool_logs ?? store.ai_calls,
      subscription_price_history: store.subscription_price_history ?? [],
      recurring_rules: store.recurring_rules ?? [],
      merchant_directory: store.merchant_directory ?? [],
      categories: store.categories ?? [],
      financial_snapshots: store.financial_snapshots ?? [],
      modes: {
        planner: plannerMode(),
        payment: paymentMode(),
        paypal: paypalMode(),
        webhook: process.env.PAYPAL_WEBHOOK_ID ? "configured" : "unset",
        agentToolkit: paypalMode() === "sandbox" ? "live" : "mock",
      },
      paypal_tool_calls: (store.paypal_tool_calls ?? []).slice(-20),
    };
  });
}

export function issueReceipt(goalId: string) {
  return updateStore((store) => {
    const existing = store.receipts.find((r) => r.goal_id === goalId);
    if (existing) return existing;
    const receipt = buildReceipt(store, goalId);
    store.receipts.push(receipt);
    appendEvent(store, "receipt.issued", `Signed receipt ${receipt.receipt_id} issued (${receipt.outcome})`, {
      goal_id: goalId,
      receipt_id: receipt.receipt_id,
      audit_hash: receipt.audit_hash,
      total_spent: receipt.total_spent,
      outcome: receipt.outcome,
    });
    return receipt;
  });
}

export { SEED_MERCHANTS, remainingBudget };
