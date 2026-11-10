import { DEMO_GOAL_TEXT, SEED_MERCHANTS, X402_MAX_USD } from "./catalog";
import { signPayload } from "./crypto";
import { draftEvidence } from "./evidence";
import { appendEvent } from "./events";
import { id, nowIso } from "./ids";
import { authorizeOrder, captureAuthorization, createAuthorizeOrder, refundCapture, voidAuthorization } from "./paypal";
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
    max_total_spend: number;
    auto_approve_limit: number;
    approved_merchants: string[];
    allowed_categories: string[];
    expires_at?: string;
  },
): Mandate {
  const expires_at =
    input.expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const unsigned: Omit<Mandate, "signature"> = {
    mandate_id: id("mand"),
    goal_id: input.goal_id,
    max_total_spend: input.max_total_spend,
    auto_approve_limit: input.auto_approve_limit,
    approved_merchants: input.approved_merchants,
    allowed_categories: input.allowed_categories,
    expires_at,
    status: "active",
    signed_at: nowIso(),
    public_key: store.settings.signing.publicKeyPem,
  };
  const signature = signPayload(mandateSigningPayload(unsigned), store.settings.signing.privateKeyPem);
  const mandate: Mandate = { ...unsigned, signature };
  store.mandates.push(mandate);
  appendEvent(store, "mandate.signed", `Ed25519-signed mandate ${mandate.mandate_id} created`, {
    goal_id: mandate.goal_id,
    mandate_id: mandate.mandate_id,
    max_total_spend: mandate.max_total_spend,
    auto_approve_limit: mandate.auto_approve_limit,
  });
  return mandate;
}

export function policyForStep(
  store: StoreData,
  mandate: Mandate,
  step: PlanStep,
): PolicyDecision {
  const merchant = store.merchants.find((m) => m.merchant_id === step.merchant_id);
  if (!merchant) {
    return {
      decision_id: id("pol"),
      step_id: step.step_id,
      merchant_id: step.merchant_id,
      amount: step.amount,
      decision: "block",
      reason: `Unknown merchant ${step.merchant_id}.`,
      checks: [{ code: "merchant", passed: false, detail: "Merchant not in catalog." }],
      created_at: nowIso(),
    };
  }
  const firstTime = !store.payments.some(
    (p) =>
      p.merchant_id === step.merchant_id &&
      ["captured", "settled", "authorized"].includes(p.status),
  );
  const decision = evaluatePolicy({
    mandate,
    merchant,
    amount: step.amount,
    category: step.category,
    recurring: step.recurring,
    remainingBudget: remainingBudget(store, mandate.mandate_id),
    killSwitch: store.settings.kill_switch,
    firstTimeMerchant: firstTime,
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
    rail: opts.step.rail,
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

  if (decision.decision === "block") {
    return { decision };
  }

  if (decision.decision === "needs-approval" && !opts.afterHumanApproval) {
    const payment = newPayment({
      plan,
      step,
      status: "awaiting_approval",
      approval: "human",
    });
    store.payments.push(payment);
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
      `Human approval requested for ${step.merchant_name} ($${step.amount.toFixed(2)})`,
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

  if (step.rail === "x402_usdc" || step.amount < X402_MAX_USD) {
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

  const order = await createAuthorizeOrder({
    amount: step.amount,
    description: `${step.action} at ${step.merchant_name} (agent on behalf of user)`,
    customId: payment.payment_id,
    returnUrl: `${appUrl()}/paypal/return?payment_id=${encodeURIComponent(payment.payment_id)}`,
    cancelUrl: `${appUrl()}/paypal/cancel?payment_id=${encodeURIComponent(payment.payment_id)}`,
  });
  payment.rail = "paypal_sandbox";
  payment.paypal = {
    mode: order.mode,
    order_id: order.order_id,
    approve_url: order.approve_url,
  };
  payment.status = "awaiting_buyer";
  payment.updated_at = nowIso();
  appendEvent(
    store,
    "payment.paypal.order_created",
    `PayPal ${order.mode} order ${order.order_id} created with intent=AUTHORIZE for $${step.amount.toFixed(2)}`,
    {
      goal_id: plan.goal_id,
      payment_id: payment.payment_id,
      order_id: order.order_id,
      mode: order.mode,
      approve_url: order.approve_url,
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

export async function completePaypalAfterBuyer(store: StoreData, paymentId: string, orderId?: string) {
  const payment = store.payments.find((p) => p.payment_id === paymentId);
  if (!payment) throw new Error("Payment not found");
  const plan = store.plans.find((p) => p.plan_id === payment.plan_id);
  const step = plan?.steps.find((s) => s.step_id === payment.step_id);
  if (!plan || !step) throw new Error("Plan step not found");

  const oid = orderId || payment.paypal?.order_id;
  if (!oid) throw new Error("Missing PayPal order id");

  const auth = await authorizeOrder(oid);
  payment.paypal = {
    ...(payment.paypal || { mode: auth.mode }),
    mode: auth.mode,
    order_id: oid,
    authorization_id: auth.authorization_id,
  };
  payment.status = "authorized";
  payment.updated_at = nowIso();
  appendEvent(
    store,
    "payment.paypal.authorized",
    `PayPal authorization ${auth.authorization_id} held (not captured) for ${payment.merchant_name}`,
    {
      goal_id: payment.goal_id,
      payment_id: payment.payment_id,
      authorization_id: auth.authorization_id,
      mode: auth.mode,
    },
  );

  const verification = fulfillAndMaybeSettle(store, payment, step);
  if (verification.status === "passed") {
    const cap = await captureAuthorization(auth.authorization_id);
    payment.paypal.capture_id = cap.capture_id;
    payment.status = "captured";
    payment.updated_at = nowIso();
    appendEvent(
      store,
      "payment.paypal.captured",
      `PayPal capture ${cap.capture_id} after verification passed`,
      {
        goal_id: payment.goal_id,
        payment_id: payment.payment_id,
        capture_id: cap.capture_id,
        mode: cap.mode,
      },
    );
  } else {
    await voidAuthorization(auth.authorization_id);
    payment.status = "voided";
    payment.updated_at = nowIso();
    appendEvent(
      store,
      "payment.paypal.voided",
      `PayPal authorization ${auth.authorization_id} voided because verification failed`,
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
  if (!payment.paypal?.capture_id) throw new Error("No capture to refund");
  const ref = await refundCapture(payment.paypal.capture_id, payment.amount, "USD");
  payment.paypal.refund_id = ref.refund_id;
  payment.status = "refunded";
  payment.updated_at = nowIso();
  appendEvent(store, "payment.paypal.refunded", `PayPal refund ${ref.refund_id} issued`, {
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
      plan,
      executions,
      injection,
      planner: plannerMode(),
      paypal: paypalMode(),
    };
  });
}

export function snapshot() {
  return updateStore((store) => {
    const goal = store.goals[store.goals.length - 1] ?? null;
    const mandate = goal ? store.mandates.find((m) => m.goal_id === goal.goal_id) ?? null : store.mandates.at(-1) ?? null;
    const plan = goal ? store.plans.find((p) => p.goal_id === goal.goal_id) ?? null : store.plans.at(-1) ?? null;
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
      modes: { planner: plannerMode(), paypal: paypalMode(), paypalClientId: process.env.PAYPAL_CLIENT_ID || null },
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
