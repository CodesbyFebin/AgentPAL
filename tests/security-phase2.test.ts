import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEED_MERCHANTS } from "@/lib/catalog";
import { evaluatePolicy } from "@/lib/policy";
import { RateLimiter, rbacDecision, rateLimitGroup } from "@/lib/security";
import { resolveRole } from "@/lib/owner-session";
const roleFromCookieHeader = (c: string | null) => resolveRole(c, {} as NodeJS.ProcessEnv).role;
import { intakePayPalWebhook } from "@/lib/webhook-security";
import { withIdempotency } from "@/lib/idempotency";
import { guardedRefund } from "@/lib/refunds";
import { verifyAuditChain, auditCsv } from "@/lib/audit";
import { proposePaymentIntent } from "@/lib/ai-tools";
import { createPaymentLink } from "@/lib/pay-links";
import { startPaymentFromLink } from "@/lib/pay-link-checkout";
import { signMandateTemplate } from "@/lib/user-mandates";
import { appendEvent } from "@/lib/events";
import { resetStore, updateStore } from "@/lib/store";
import type { Mandate, Payment, StoreData } from "@/lib/types";

beforeEach(() => {
  resetStore();
});

/* ---------------- policy hardening ---------------- */
const now = new Date("2026-11-10T12:00:00.000Z");
const mandate = (o: Partial<Mandate> = {}): Mandate => ({
  mandate_id: "m", goal_id: "g", max_total_spend: 50, auto_approve_limit: 10, per_tx_limit: 10, approval_threshold: 10,
  approved_merchants: ["merchant_002"], allowed_categories: ["domain"], allow_recurring: false, minimum_balance: 0, currency: "USD",
  expires_at: "2026-11-17T00:00:00.000Z", status: "active", signed_at: "x", public_key: "x", signature: "x", ...o,
});
const domain = SEED_MERCHANTS.find((m) => m.merchant_id === "merchant_002")!;

describe("policy hardening", () => {
  it("denies NaN and Infinity amounts", () => {
    for (const amount of [NaN, Infinity, -Infinity]) {
      const d = evaluatePolicy({ mandate: mandate(), merchant: domain, amount, category: "domain", recurring: false, mandateSpend: 0, killSwitch: false, now });
      expect(d.decision).toBe("DENY");
    }
  });
  it("denies a mandate whose expiry cannot be parsed", () => {
    const d = evaluatePolicy({ mandate: mandate({ expires_at: "not-a-date" }), merchant: domain, amount: 5, category: "domain", recurring: false, mandateSpend: 0, killSwitch: false, now });
    expect(d.decision).toBe("DENY");
    expect(d.checks.find((c) => c.code === "expiry")?.passed).toBe(false);
  });
});

/* ---------------- RBAC + rate limit ---------------- */
describe("RBAC and rate limiting", () => {
  it("viewer cannot POST to money routes but can read, engage the kill switch and receive webhooks", () => {
    const viewer = roleFromCookieHeader("theme=x; agentpal_role=viewer");
    expect(viewer).toBe("viewer");
    expect(rbacDecision("POST", "/api/refunds", viewer).allowed).toBe(false);
    expect(rbacDecision("POST", "/api/payments/p1/authorize", viewer).allowed).toBe(false);
    expect(rbacDecision("GET", "/api/refunds", viewer).allowed).toBe(true);
    expect(rbacDecision("POST", "/api/kill-switch", viewer).allowed).toBe(true);
    expect(rbacDecision("POST", "/api/webhooks/paypal", viewer).allowed).toBe(true);
    // No cookie now defaults to viewer (read-only).
    expect(rbacDecision("POST", "/api/refunds", roleFromCookieHeader(null)).allowed).toBe(false);
  });
  it("rate-limits payment routes per client", () => {
    const g = rateLimitGroup("POST", "/api/payments/p1/authorize")!;
    expect(g.group).toBe("payments");
    const rl = new RateLimiter();
    const t = 1_000_000;
    for (let i = 0; i < g.limit; i++) expect(rl.hit("payments:1.2.3.4", g.limit, g.windowMs, t).ok).toBe(true);
    expect(rl.hit("payments:1.2.3.4", g.limit, g.windowMs, t).ok).toBe(false);
    expect(rl.hit("payments:5.6.7.8", g.limit, g.windowMs, t).ok).toBe(true);
    expect(rl.hit("payments:1.2.3.4", g.limit, g.windowMs, t + g.windowMs + 1).ok).toBe(true);
    expect(rateLimitGroup("GET", "/api/payments")).toBeNull();
  });
});

/* ---------------- webhook ---------------- */
function headers(over: Partial<Record<string, string>> = {}) {
  return {
    authAlgo: "SHA256withRSA",
    certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
    transmissionId: "tx-1",
    transmissionSig: "sig",
    transmissionTime: new Date(1_700_000_000_000).toISOString(),
    ...over,
  };
}

describe("PayPal webhook intake", () => {
  const nowMs = 1_700_000_000_000 + 30_000;
  it("refuses everything when PAYPAL_WEBHOOK_ID is not configured", async () => {
    const out = await updateStore((s) => intakePayPalWebhook(s, headers(), { id: "WH-1" }, { webhookId: undefined, now: nowMs, verifier: vi.fn() }));
    expect(out.status).toBe(503);
  });
  it("accepts a PayPal-verified event once and ignores the replay", async () => {
    const verifier = vi.fn(async () => ({ ok: true, status: "SUCCESS" }));
    const first = await updateStore((s) => intakePayPalWebhook(s, headers(), { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED" }, { webhookId: "WID", now: nowMs, verifier }));
    expect(first.status).toBe(200);
    expect(first.body.result).toBe("verified");
    const replay = await updateStore((s) => intakePayPalWebhook(s, headers(), { id: "WH-1" }, { webhookId: "WID", now: nowMs, verifier }));
    expect(replay.body.result).toBe("duplicate_ignored");
    expect(verifier).toHaveBeenCalledTimes(1);
  });
  it("rejects a bad signature and a stale transmission", async () => {
    const bad = await updateStore((s) => intakePayPalWebhook(s, headers({ transmissionId: "tx-2" }), { id: "WH-2" }, { webhookId: "WID", now: nowMs, verifier: async () => ({ ok: false, status: "FAILURE" }) }));
    expect(bad.status).toBe(401);
    const verifier = vi.fn(async () => ({ ok: true, status: "SUCCESS" }));
    const stale = await updateStore((s) => intakePayPalWebhook(s, headers({ transmissionId: "tx-3" }), { id: "WH-3" }, { webhookId: "WID", now: nowMs + 10 * 60_000, verifier }));
    expect(stale.body.result).toBe("stale");
    expect(verifier).not.toHaveBeenCalled();
  });
});

/* ---------------- idempotency ---------------- */
describe("Idempotency-Key", () => {
  it("replays the stored response and rejects key reuse with a different body", async () => {
    const handler = vi.fn(async () => ({ status: 201, body: { n: Math.random() } }));
    const req = () => new Request("http://x/api/refunds", { method: "POST", headers: { "idempotency-key": "k-1" } });
    const a = await withIdempotency(req(), "test", { a: 1 }, handler);
    const b = await withIdempotency(req(), "test", { a: 1 }, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await a.json()).toEqual(await b.json());
    expect(b.headers.get("Idempotent-Replayed")).toBe("true");
    const c = await withIdempotency(req(), "test", { a: 2 }, handler);
    expect(c.status).toBe(409);
  });
});

/* ---------------- refunds ---------------- */
function capturedPayment(store: StoreData, usd = 12): Payment {
  const p = {
    payment_id: "pay_test_refund", goal_id: "g", plan_id: "p", step_id: "s", mandate_id: "m", merchant_id: "merchant_002",
    merchant_name: "Nameforge Domains", amount: usd, currency: "USD", status: "captured", rail: "paypal_sandbox",
    paypal: { mode: "mock", capture_id: "MOCK-CAP-1", settlement_amount: usd, settlement_currency: "USD" },
    created_at: "x", updated_at: "x",
  } as unknown as Payment;
  store.payments.push(p);
  return p;
}

describe("Guarded refunds", () => {
  it("allows partial refunds up to the cap, then blocks anything above what remains", async () => {
    await updateStore(async (s) => {
      capturedPayment(s, 12);
      const a = await guardedRefund(s, { payment_id: "pay_test_refund", amount: 5, reason: "partial goodwill" });
      expect(a.status).toBe("COMPLETED");
      expect(a.kind).toBe("partial");
      const over = await guardedRefund(s, { payment_id: "pay_test_refund", amount: 7.01, reason: "too much" });
      expect(over.status).toBe("BLOCKED");
      const rest = await guardedRefund(s, { payment_id: "pay_test_refund", reason: "remainder" });
      expect(rest.status).toBe("COMPLETED");
      expect(rest.amount).toBe(7);
      expect(s.payments[0].status).toBe("refunded");
      const nan = await guardedRefund(s, { payment_id: "pay_test_refund", amount: NaN, reason: "x y z" });
      expect(nan.status).toBe("BLOCKED");
    });
  });
  it("requires a reason and is blocked by the kill switch (no processor call)", async () => {
    await updateStore(async (s) => {
      capturedPayment(s, 12);
      expect((await guardedRefund(s, { payment_id: "pay_test_refund", reason: "" })).status).toBe("BLOCKED");
      s.settings.kill_switch = true;
      const r = await guardedRefund(s, { payment_id: "pay_test_refund", reason: "customer asked" });
      expect(r.status).toBe("BLOCKED");
      expect(r.block_reason).toMatch(/Kill switch/);
      expect(s.events.some((e) => e.type === "refund.blocked")).toBe(true);
    });
  });
});

/* ---------------- audit ---------------- */
describe("audit chain", () => {
  it("detects tampering and exports formula-safe CSV", async () => {
    await updateStore((s) => {
      appendEvent(s, "a", "=HYPERLINK(evil)", {});
      appendEvent(s, "b", "two", {});
      expect(verifyAuditChain(s.events).ok).toBe(true);
      expect(auditCsv(s.events)).toContain(`"'=HYPERLINK(evil)"`);
      const copy = structuredClone(s.events);
      copy[0].message = "tampered";
      expect(verifyAuditChain(copy).ok).toBe(false);
    });
  });
});

/* ---------------- Coach authority ---------------- */
describe("Coach can never create authority, pick amounts or self-approve", () => {
  it("propose_payment returns no_mandate instead of minting one", async () => {
    await updateStore(async (s) => {
      const before = s.mandates.length;
      const r = (await proposePaymentIntent(s, "nova_sleeve_2499")) as { status?: string };
      expect(r.status).toBe("no_mandate");
      expect(s.mandates.length).toBe(before);
    });
  });
});

/* ---------------- pay link catalog price ---------------- */
describe("payment links use the server catalog price for SKU links", () => {
  it("ignores a client-supplied amount when the link has a product_sku", async () => {
    await updateStore(async (s) => {
      const m = signMandateTemplate(s, "personal_inr");
      const link = createPaymentLink(s, { mandate_id: m.mandate_id, amount_cap: 3000, merchant_id: "merchant_pixelforge", product_sku: "nova_sleeve_2499", currency: "INR" });
      const r = await startPaymentFromLink(s, link.link_id, 1);
      expect(r.payment?.amount ?? r.decision?.amount).toBe(2499);
    });
  });
});
