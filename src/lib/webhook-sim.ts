/**
 * LOCAL webhook-verification simulator (labelled as such in the UI). It runs the REAL intake pipeline
 * (intakePayPalWebhook: required headers, ±5 min freshness, replay protection, signature verification)
 * against a scratch store, with a locally generated RSA-2048 key standing in for PayPal's certificate.
 * The signed message mirrors PayPal's inputs: transmission_id|transmission_time|webhook_id|crc32(body).
 * It never touches PayPal or the app's real store.
 */
import { createSign, createVerify, generateKeyPairSync, randomUUID } from "crypto";
import * as zlib from "zlib";
import { intakePayPalWebhook } from "./webhook-security";
import type { PayPalWebhookHeaders } from "./paypal";
import type { StoreData } from "./types";

const SIM_WEBHOOK_ID = "SIM-WEBHOOK-ID-LOCAL";
let keys: { publicKey: string; privateKey: string } | null = null;
function simKeys() {
  keys ??= generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return keys;
}

function crc32(s: string): number {
  const z = zlib as unknown as { crc32?: (d: string | Buffer) => number };
  if (z.crc32) return z.crc32(s) >>> 0;
  let c = ~0;
  for (const b of Buffer.from(s)) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const message = (h: { transmissionId: string; transmissionTime: string }, body: string) =>
  `${h.transmissionId}|${h.transmissionTime}|${SIM_WEBHOOK_ID}|${crc32(body)}`;

function scratchStore(): StoreData {
  return { events: [], webhook_transmissions: [], webhook_receipts: [] } as unknown as StoreData;
}
let scratch = scratchStore();
let last: { headers: PayPalWebhookHeaders; body: string } | null = null;

export type SimCase = "valid" | "tampered" | "replay" | "stale" | "reset";

export async function runWebhookSim(kind: SimCase, now = Date.now()) {
  if (kind === "reset") {
    scratch = scratchStore();
    last = null;
    return { case: kind, status: 200, result: "reset", detail: "Simulator replay cache cleared." };
  }
  let headers: PayPalWebhookHeaders;
  let body: string;
  if (kind === "replay") {
    if (!last) return { case: kind, status: 409, result: "nothing_to_replay", detail: "Send a valid event first, then replay it." };
    ({ headers, body } = last);
  } else {
    const event = { id: `WH-SIM-${randomUUID().slice(0, 8)}`, event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { amount: { value: "8.00", currency_code: "USD" }, simulated: true } };
    body = JSON.stringify(event);
    const transmissionTime = new Date(kind === "stale" ? now - 10 * 60 * 1000 : now).toISOString();
    const base = { transmissionId: randomUUID(), transmissionTime };
    const sig = createSign("RSA-SHA256").update(message(base, body)).sign(simKeys().privateKey, "base64");
    headers = { ...base, transmissionSig: sig, authAlgo: "SHA256withRSA", certUrl: "local-simulator://cert" };
    if (kind === "valid") last = { headers, body };
    if (kind === "tampered") body = body.replace('"8.00"', '"800.00"'); // attacker edits the amount after signing
  }
  const verifier = async (h: PayPalWebhookHeaders) => {
    const ok = createVerify("RSA-SHA256").update(message(h, body)).verify(simKeys().publicKey, h.transmissionSig, "base64");
    return { ok, status: ok ? "SUCCESS" : "FAILURE" };
  };
  const out = await intakePayPalWebhook(scratch, headers, JSON.parse(body), { verifier, now, webhookId: SIM_WEBHOOK_ID });
  return {
    case: kind,
    status: out.status,
    result: out.body.result,
    detail: out.body.detail?.replace("PayPal verification status", "Signature verification (local key):"),
    signed_message: `${headers.transmissionId.slice(0, 8)}…|${headers.transmissionTime}|${SIM_WEBHOOK_ID}|crc32(body)`,
    body_preview: body.slice(0, 140),
  };
}
