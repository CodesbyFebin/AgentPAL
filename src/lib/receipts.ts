import { chainHash, signPayload, verifyPayload } from "./crypto";
import { canonicalJson, id, nowIso } from "./ids";
import type { AuditEvent, Mandate, Payment, Receipt, StoreData, Verification } from "./types";
import { capturedSpend, remainingBudget } from "./store";

export function mandateSigningPayload(mandate: Omit<Mandate, "signature">) {
  const { signature: _ignored, ...rest } = mandate as Mandate & { signature?: string };
  void _ignored;
  return rest;
}

export function unsignedReceiptBody(receipt: Omit<Receipt, "signature">) {
  return receipt;
}

export function buildReceipt(store: StoreData, goalId: string): Receipt {
  const goal = store.goals.find((g) => g.goal_id === goalId);
  if (!goal) throw new Error("Goal not found");
  const mandate = store.mandates.find((m) => m.goal_id === goalId);
  if (!mandate) throw new Error("Mandate not found");

  const payments = store.payments.filter((p) => p.goal_id === goalId);
  const verifications = store.verifications.filter((v) =>
    payments.some((p) => p.payment_id === v.payment_id),
  );
  const relatedEvents = store.events.filter(
    (e) =>
      e.payload.goal_id === goalId ||
      payments.some((p) => p.payment_id === e.payload.payment_id),
  );

  const total_spent = capturedSpend(store, mandate.mandate_id);
  const remaining_budget = remainingBudget(store, mandate.mandate_id);
  const failed = verifications.some((v) => v.status === "failed");
  const anySettled = payments.some((p) => p.status === "captured" || p.status === "settled");
  const outcome: Receipt["outcome"] = failed && anySettled ? "partial" : failed || !anySettled ? "failed" : "delivered";

  const summary = formatSummary({
    goal: goal.objective,
    payments,
    verifications,
    total_spent,
    remaining_budget,
    outcome,
  });

  const event_ids = relatedEvents.map((e) => e.event_id);
  const audit_hash = hashEventChain(relatedEvents);

  const unsigned: Omit<Receipt, "signature"> = {
    receipt_id: id("rcpt"),
    goal_id: goalId,
    mandate_id: mandate.mandate_id,
    total_spent,
    currency: "USD",
    remaining_budget,
    outcome,
    payments: payments.map((p) => p.payment_id),
    summary,
    audit_hash,
    event_ids,
    public_key: store.settings.signing.publicKeyPem,
    created_at: nowIso(),
  };

  const signature = signPayload(unsigned, store.settings.signing.privateKeyPem);
  return { ...unsigned, signature };
}

export function verifyReceiptSignature(receipt: Receipt): boolean {
  const { signature, ...unsigned } = receipt;
  return verifyPayload(unsigned, receipt.public_key, signature);
}

export function hashEventChain(events: AuditEvent[]): string {
  if (events.length === 0) return `sha256:${"0".repeat(64)}`;
  // Re-hash the ordered event ids + hashes so the receipt commits to the chain.
  let acc = "0".repeat(64);
  for (const event of events) {
    acc = chainHash(acc, { event_id: event.event_id, hash: event.hash, prev_hash: event.prev_hash });
  }
  return `sha256:${acc}`;
}

function formatSummary(opts: {
  goal: string;
  payments: Payment[];
  verifications: Verification[];
  total_spent: number;
  remaining_budget: number;
  outcome: Receipt["outcome"];
}): string {
  const lines = [
    `AgentPaL Receipt`,
    `Task: ${opts.goal}`,
    `Outcome: ${opts.outcome}`,
    ``,
    `Payments:`,
  ];
  for (const p of opts.payments) {
    const v = opts.verifications.find((x) => x.payment_id === p.payment_id);
    const rail = p.rail === "x402_usdc" ? "simulated x402/USDC" : p.paypal?.mode === "mock" ? "PayPal (mock)" : "PayPal sandbox";
    lines.push(
      `- ${p.merchant_name}: $${p.amount.toFixed(2)} via ${rail} (${p.status}${p.approval === "human" ? ", human approved" : p.approval === "auto" ? ", auto-approved" : ""})`,
    );
    if (v) {
      lines.push(`  Verification: ${v.status} — ${v.checks.map((c) => `${c.name}:${c.passed ? "pass" : "fail"}`).join(", ")}`);
    }
  }
  lines.push(``);
  lines.push(`Total spent: $${opts.total_spent.toFixed(2)}`);
  lines.push(`Remaining budget: $${opts.remaining_budget.toFixed(2)}`);
  lines.push(`Attribution: paid by agent on behalf of user`);
  return lines.join("\n");
}

export { canonicalJson };
