import { appendEvent } from "./events";
import { nowIso } from "./ids";
import { verifyWebhookSignature, type PayPalWebhookHeaders } from "./paypal";
import type { StoreData } from "./types";

export const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

export type Verifier = (headers: PayPalWebhookHeaders, event: unknown) => Promise<{ ok: boolean; status: string }>;

export interface WebhookOutcome {
  status: number;
  body: { ok: boolean; result: string; event_id?: string; detail?: string };
}

/**
 * Hardened PayPal webhook intake:
 * 1. PAYPAL_WEBHOOK_ID must be configured (otherwise 503, nothing processed).
 * 2. Required PayPal transmission headers present.
 * 3. Transmission time within ±5 minutes (stale or future → rejected).
 * 4. Replay protection: a transmission id (or event id) seen before is ignored.
 * 5. Signature verified by PayPal's verify-webhook-signature API.
 */
export async function intakePayPalWebhook(
  store: StoreData,
  headers: PayPalWebhookHeaders,
  event: { id?: string; event_type?: string; resource?: Record<string, unknown> },
  opts: { verifier?: Verifier; now?: number; webhookId?: string | undefined } = {},
): Promise<WebhookOutcome> {
  const now = opts.now ?? Date.now();
  const webhookId = "webhookId" in opts ? opts.webhookId : process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    return { status: 503, body: { ok: false, result: "not_configured", detail: "PAYPAL_WEBHOOK_ID is not set; webhooks are not processed." } };
  }
  if (!headers.transmissionId || !headers.transmissionSig || !headers.transmissionTime || !headers.certUrl || !headers.authAlgo) {
    return reject(store, 400, "missing_headers", event, "Missing PayPal transmission headers.");
  }
  const sentAt = Date.parse(headers.transmissionTime);
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > WEBHOOK_MAX_AGE_MS) {
    return reject(store, 400, "stale", event, "Transmission time is outside the 5-minute window (possible replay).");
  }
  if (
    store.webhook_transmissions.some((t) => t.transmission_id === headers.transmissionId || (event.id && t.event_id === event.id))
  ) {
    appendEvent(store, "webhook.replay_ignored", `Replayed PayPal webhook ignored (transmission ${headers.transmissionId.slice(0, 16)})`, {
      event_id: event.id,
    });
    return { status: 200, body: { ok: true, result: "duplicate_ignored", event_id: event.id } };
  }
  const verify = opts.verifier || ((h: PayPalWebhookHeaders, e: unknown) => verifyWebhookSignature(h, e));
  let verdict: { ok: boolean; status: string };
  try {
    verdict = await verify(headers, event);
  } catch (err) {
    return reject(store, 502, "verify_error", event, (err instanceof Error ? err.message : "verification error").slice(0, 160));
  }
  if (!verdict.ok) return reject(store, 401, "bad_signature", event, `PayPal verification status ${verdict.status}.`);

  store.webhook_transmissions.push({ transmission_id: headers.transmissionId, event_id: event.id, seen_at: nowIso() });
  if (store.webhook_transmissions.length > 2000) store.webhook_transmissions.splice(0, store.webhook_transmissions.length - 2000);
  store.webhook_receipts.push({
    event_id: event.id || headers.transmissionId,
    event_type: event.event_type || "unknown",
    verified: true,
    verification: "paypal",
    processed_at: nowIso(),
  });
  appendEvent(store, "webhook.verified", `PayPal webhook ${event.event_type || "unknown"} verified by PayPal (signature SUCCESS).`, {
    event_id: event.id,
    event_type: event.event_type,
    verification: "paypal",
  });
  return { status: 200, body: { ok: true, result: "verified", event_id: event.id } };
}

function reject(store: StoreData, status: number, result: string, event: { id?: string; event_type?: string }, detail: string): WebhookOutcome {
  store.webhook_receipts.push({
    event_id: event.id || "unknown",
    event_type: event.event_type || "unknown",
    verified: false,
    verification: "failed",
    processed_at: nowIso(),
  });
  appendEvent(store, "webhook.rejected", `PayPal webhook rejected (${result}): ${detail}`, { event_id: event.id, result });
  return { status, body: { ok: false, result, event_id: event.id, detail } };
}
