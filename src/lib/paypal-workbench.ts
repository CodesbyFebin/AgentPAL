import { hasPayPalCreds, paypalSandboxRequest } from "./paypal";
import { sha256Hex } from "./crypto";

export const PAYPAL_LOOKUPS = {
  payout: { label: "Payout batch", prefix: "/v1/payments/payouts/" },
  vault: { label: "Saved payment token", prefix: "/v3/vault/payment-tokens/" },
  tracking: { label: "Shipment tracker", prefix: "/v1/shipping/trackers/" },
} as const;

export type LookupKind = keyof typeof PAYPAL_LOOKUPS;
type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value && typeof value === "object" ? value as Json : {};
}

export async function lookupPayPalResource(kind: LookupKind, reference: string) {
  if (!hasPayPalCreds()) return { mode: "mock", kind, reference, status: "DEMO_LOOKUP" };
  const resource = await paypalSandboxRequest(PAYPAL_LOOKUPS[kind].prefix + encodeURIComponent(reference));
  if (kind === "payout") {
    const batch = object(resource.batch_header);
    return { mode: "sandbox", kind, reference, status: batch.batch_status };
  }
  if (kind === "vault") {
    // Token IDs are provided by the owner. Return only the funding source type.
    const source = object(resource.payment_source);
    return { mode: "sandbox", kind, status: "FOUND", sourceTypes: Object.keys(source) };
  }
  return { mode: "sandbox", kind, reference, status: resource.status, carrier: resource.carrier };
}

export async function submitSandboxPayout(amount: number, idempotencyKey: string) {
  const recipient = process.env.AGENTPAL_PAYOUT_SANDBOX_EMAIL;
  if (!hasPayPalCreds() || !recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new Error("Configure a PayPal sandbox app and a sandbox payout recipient first.");
  }
  const senderId = `agentpal_${sha256Hex(idempotencyKey).slice(0, 28)}`;
  const result = await paypalSandboxRequest("/v1/payments/payouts", {
    method: "POST",
    headers: { "PayPal-Request-Id": senderId },
    body: JSON.stringify({
      sender_batch_header: { sender_batch_id: senderId, email_subject: "AgentPaL sandbox payout" },
      items: [{
        recipient_type: "EMAIL",
        receiver: recipient,
        amount: { value: amount.toFixed(2), currency: "USD" },
        sender_item_id: senderId,
      }],
    }),
  });
  const batch = object(result.batch_header);
  if (typeof batch.payout_batch_id !== "string") throw new Error("PayPal did not return a payout batch ID.");
  return { mode: "sandbox", kind: "payout", reference: batch.payout_batch_id, status: batch.batch_status };
}
