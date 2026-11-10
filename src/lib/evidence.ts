import { chatText } from "./ai";
import { id, nowIso } from "./ids";
import type { EvidenceDraft, Payment, Verification } from "./types";

export function templateEvidence(payment: Payment, verification?: Verification): EvidenceDraft {
  const failed = verification?.checks.filter((c) => !c.passed) ?? [];
  const body = [
    `Dispute / refund evidence (neutral summary)`,
    ``,
    `Payment ID: ${payment.payment_id}`,
    `Merchant: ${payment.merchant_name} (${payment.merchant_id})`,
    `Amount: $${payment.amount.toFixed(2)} ${payment.currency}`,
    `Rail: ${payment.rail}${payment.paypal?.mode ? ` (${payment.paypal.mode})` : payment.x402 ? " (simulated)" : ""}`,
    `PayPal references: order=${payment.paypal?.order_id ?? "n/a"}, authorization=${payment.paypal?.authorization_id ?? "n/a"}, capture=${payment.paypal?.capture_id ?? "n/a"}`,
    `Status: ${payment.status}`,
    ``,
    `The purchase was initiated by an AI agent on behalf of the user under a signed spending mandate.`,
    `Outcome verification ${verification ? `was ${verification.status}` : "was not recorded"}.`,
    failed.length
      ? `Failed checks:\n${failed.map((c) => `- ${c.name}: ${c.detail}`).join("\n")}`
      : `No failed checks were attached.`,
    ``,
    `Requested remedy: full refund under the outcome contract (full_refund_if_failed), because the delivered artifact did not meet the agreed verification checks.`,
    `This summary is factual and does not allege fraud beyond the verification failure itself.`,
  ].join("\n");

  return {
    evidence_id: id("evd"),
    payment_id: payment.payment_id,
    source: "template",
    title: `Refund evidence for ${payment.merchant_name} (${payment.payment_id})`,
    body,
    created_at: nowIso(),
  };
}

export async function draftEvidence(payment: Payment, verification?: Verification): Promise<EvidenceDraft> {
  if (!process.env.AI_API_KEY) return templateEvidence(payment, verification);
  try {
    const { text } = await chatText([
      {
        role: "system",
        content:
          "Draft a short, neutral refund/dispute evidence summary for a payments reviewer. Stick to facts. Do not rant. Do not invent policies. Return plain text only.",
      },
      {
        role: "user",
        content: JSON.stringify({ payment, verification }),
      },
    ]);
    if (!text.trim()) return templateEvidence(payment, verification);
    return {
      evidence_id: id("evd"),
      payment_id: payment.payment_id,
      source: "ai",
      title: `Refund evidence for ${payment.merchant_name} (${payment.payment_id})`,
      body: text.trim(),
      created_at: nowIso(),
    };
  } catch {
    return templateEvidence(payment, verification);
  }
}
