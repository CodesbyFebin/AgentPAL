import type { AuditEvent, Payment, Verification } from "./types";

export type SettlementStepId = "authorized" | "policy_verified" | "submitted_for_settlement" | "settled";
export type SettlementSource = "braintree" | "paypal" | "policy" | "simulated";
export type SettlementStepState = "complete" | "current" | "pending" | "failed" | "skipped";

export interface SettlementStep {
  id: SettlementStepId;
  label: string;
  state: SettlementStepState;
  at?: string;
  source: SettlementSource;
  simulated: boolean;
  detail: string;
  processor_status?: string;
}

const AUTH_EVENTS = new Set([
  "payment.braintree.authorized",
  "payment.paypal.authorized",
  "payment.x402.simulated",
]);
const CAPTURE_EVENTS = new Set([
  "payment.braintree.captured",
  "payment.paypal.captured",
]);
const VERIFY_EVENTS = new Set(["verification.completed"]);

function eventAt(events: AuditEvent[], paymentId: string, types: Set<string>): AuditEvent | undefined {
  return events.find((e) => types.has(e.type) && e.payload.payment_id === paymentId);
}

function processorMode(payment: Payment): "sandbox" | "mock" | "none" {
  if (payment.rail === "x402_usdc") return "mock";
  return payment.braintree?.mode || payment.paypal?.mode || "none";
}

function sourceFor(payment: Payment, simulated: boolean): SettlementSource {
  if (simulated) return "simulated";
  if (payment.rail === "braintree_sandbox") return "braintree";
  if (payment.rail === "paypal_sandbox") return "paypal";
  return "simulated";
}

export function settlementTimeline(opts: {
  payment: Payment;
  verifications: Verification[];
  events: AuditEvent[];
}): SettlementStep[] {
  const { payment, verifications, events } = opts;
  const mode = processorMode(payment);
  const simulatedRail = mode === "mock" || payment.rail === "x402_usdc";
  const btStatus = payment.braintree?.status;
  const verification = verifications.find((v) => v.payment_id === payment.payment_id);
  const authEvent = eventAt(events, payment.payment_id, AUTH_EVENTS);
  const verifyEvent = eventAt(events, payment.payment_id, VERIFY_EVENTS);
  const captureEvent = eventAt(events, payment.payment_id, CAPTURE_EVENTS);

  const reachedAuth = [
    "authorized",
    "captured",
    "settled",
    "voided",
    "refunded",
  ].includes(payment.status) || Boolean(authEvent) || Boolean(payment.braintree?.authorization_id || payment.paypal?.authorization_id);

  const authorized: SettlementStep = {
    id: "authorized",
    label: "Authorized",
    state: reachedAuth ? "complete" : payment.status === "failed" ? "failed" : payment.status === "awaiting_buyer" || payment.status === "awaiting_approval" || payment.status === "proposed" ? "pending" : "pending",
    at: authEvent?.at || (reachedAuth ? payment.updated_at : undefined),
    source: sourceFor(payment, simulatedRail),
    simulated: simulatedRail,
    detail: reachedAuth
      ? simulatedRail
        ? "Authorization recorded on the labelled mock rail. No processor authorization id from a live sandbox."
        : payment.rail === "braintree_sandbox"
          ? `Braintree authorization held${btStatus ? ` (status: ${btStatus})` : ""}. Funds are not captured yet at this step.`
          : "PayPal authorization held. Funds are not captured yet at this step."
      : "Waiting for buyer approval and authorization.",
    processor_status: btStatus,
  };

  let verifyState: SettlementStepState = "pending";
  let verifyDetail = "AgentPaL Guard will verify the outcome after authorization.";
  if (verification?.status === "passed") {
    verifyState = "complete";
    verifyDetail = "Policy and outcome verification passed. Capture may proceed.";
  } else if (verification?.status === "failed") {
    verifyState = "failed";
    verifyDetail = "Outcome verification failed. The authorization was voided and nothing was submitted for settlement.";
  } else if (!reachedAuth) {
    verifyState = "pending";
  }

  const policyVerified: SettlementStep = {
    id: "policy_verified",
    label: "Policy verified",
    state: verifyState,
    at: verifyEvent?.at || (verification ? verification.created_at : undefined),
    source: "policy",
    simulated: false,
    detail: verifyDetail,
  };

  const submittedReal =
    btStatus === "submitted_for_settlement" ||
    btStatus === "settling" ||
    btStatus === "settled" ||
    Boolean(payment.braintree?.capture_id && payment.braintree.mode === "sandbox");
  const captured = payment.status === "captured" || payment.status === "settled" || payment.status === "refunded" || Boolean(payment.paypal?.capture_id || payment.braintree?.capture_id);

  let submitState: SettlementStepState = "pending";
  let submitDetail = "Capture / submit-for-settlement has not happened yet.";
  let submitSimulated = simulatedRail;
  let submitSource: SettlementSource = sourceFor(payment, simulatedRail);
  if (verifyState === "failed" || payment.status === "voided") {
    submitState = "skipped";
    submitDetail = "Skipped because verification failed or the authorization was voided.";
    submitSimulated = false;
    submitSource = "policy";
  } else if (submittedReal && payment.rail === "braintree_sandbox" && payment.braintree?.mode === "sandbox") {
    submitState = "complete";
    submitSimulated = false;
    submitSource = "braintree";
    submitDetail = `Braintree returned status “${btStatus || "submitted_for_settlement"}”. This is a sandbox processor status, not live money.`;
  } else if (captured && payment.rail === "paypal_sandbox" && payment.paypal?.mode === "sandbox") {
    submitState = "complete";
    submitSimulated = false;
    submitSource = "paypal";
    submitDetail = "PayPal sandbox capture completed. This is the closest equivalent to submit-for-settlement on that rail.";
  } else if (captured && simulatedRail) {
    submitState = "complete";
    submitSimulated = true;
    submitSource = "simulated";
    submitDetail = "Simulated submit-for-settlement on the labelled mock rail. No processor settlement status is available.";
  }

  const submitted: SettlementStep = {
    id: "submitted_for_settlement",
    label: "Submitted for settlement",
    state: submitState,
    at: captureEvent?.at || (submitState === "complete" ? payment.updated_at : undefined),
    source: submitSource,
    simulated: submitSimulated,
    detail: submitDetail,
    processor_status: btStatus,
  };

  const settledReal = btStatus === "settled" || (payment.status === "settled" && payment.braintree?.mode === "sandbox" && btStatus === "settled");
  let settledState: SettlementStepState = "pending";
  let settledDetail = "Waiting for a settled status from the payment processor.";
  let settledSimulated = simulatedRail;
  let settledSource: SettlementSource = sourceFor(payment, simulatedRail);

  if (submitState === "skipped") {
    settledState = "skipped";
    settledDetail = "Skipped because the payment was not submitted for settlement.";
    settledSimulated = false;
    settledSource = "policy";
  } else if (settledReal) {
    settledState = "complete";
    settledSimulated = false;
    settledSource = "braintree";
    settledDetail = "Braintree returned status “settled”.";
  } else if (payment.status === "settled" && payment.rail === "x402_usdc") {
    settledState = "complete";
    settledSimulated = true;
    settledSource = "simulated";
    settledDetail = "Simulated settlement (x402/USDC is labelled simulated in this demo).";
  } else if (captured && simulatedRail) {
    settledState = "complete";
    settledSimulated = true;
    settledSource = "simulated";
    settledDetail = "Simulated settled state (mock payment rail). The processor did not return a settled status.";
  } else if (submitState === "complete" && payment.rail === "braintree_sandbox") {
    settledState = "pending";
    settledSimulated = false;
    settledSource = "braintree";
    settledDetail = "Braintree sandbox often remains at “submitted_for_settlement”. This step is pending, not marked as a simulated settlement.";
  } else if (submitState === "complete" && payment.rail === "paypal_sandbox" && payment.paypal?.mode === "sandbox") {
    settledState = "complete";
    settledSimulated = true;
    settledSource = "simulated";
    settledDetail = "PayPal sandbox capture is complete. A distinct “settled” processor status was not returned, so this final step is marked simulated.";
  }

  const settled: SettlementStep = {
    id: "settled",
    label: "Settled",
    state: settledState,
    at: settledState === "complete" ? payment.updated_at : undefined,
    source: settledSource,
    simulated: settledSimulated,
    detail: settledDetail,
    processor_status: btStatus,
  };

  // Mark the first non-complete, non-skipped step as current for the UI.
  const steps = [authorized, policyVerified, submitted, settled];
  const current = steps.find((s) => s.state === "pending" || s.state === "failed");
  if (current && current.state === "pending") current.state = "current";
  return steps;
}

export function settlementTimelinesFor(
  payments: Payment[],
  verifications: Verification[],
  events: AuditEvent[],
): Record<string, SettlementStep[]> {
  const out: Record<string, SettlementStep[]> = {};
  for (const payment of payments) {
    out[payment.payment_id] = settlementTimeline({ payment, verifications, events });
  }
  return out;
}
