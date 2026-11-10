import { describe, expect, it } from "vitest";
import { chainHash, generateEd25519Pem, signPayload, verifyPayload } from "@/lib/crypto";
import { appendEvent } from "@/lib/events";
import { hashEventChain, verifyReceiptSignature, buildReceipt } from "@/lib/receipts";
import { generateEd25519Pem as gen } from "@/lib/crypto";
import type { Receipt, StoreData, Goal, Mandate, Payment, AuditEvent } from "@/lib/types";

describe("Ed25519 signing and receipt audit hash", () => {
  it("signs and verifies a mandate payload, and rejects tampering", () => {
    const keys = generateEd25519Pem();
    const payload = {
      mandate_id: "mand_001",
      max_total_spend: 50,
      auto_approve_limit: 10,
      approved_merchants: ["merchant_001", "merchant_002"],
    };
    const signature = signPayload(payload, keys.privateKeyPem);
    expect(verifyPayload(payload, keys.publicKeyPem, signature)).toBe(true);
    expect(
      verifyPayload({ ...payload, max_total_spend: 500 }, keys.publicKeyPem, signature),
    ).toBe(false);
  });

  it("builds a hash chain where each event links to the previous hash", () => {
    const store = { events: [] as AuditEvent[] } as StoreData;
    const a = appendEvent(store, "goal.created", "goal", { goal_id: "g1" });
    const b = appendEvent(store, "mandate.signed", "mandate", { goal_id: "g1" });
    expect(a.prev_hash).toBe("0".repeat(64));
    expect(b.prev_hash).toBe(a.hash);
    expect(b.hash).toBe(
      chainHash(a.hash, {
        event_id: b.event_id,
        type: b.type,
        at: b.at,
        message: b.message,
        attribution: b.attribution,
        payload: b.payload,
        prev_hash: b.prev_hash,
      }),
    );
    const acc = hashEventChain(store.events);
    expect(acc.startsWith("sha256:")).toBe(true);
    expect(acc.length).toBe("sha256:".length + 64);
  });

  it("issues a signed receipt that verifies and fails if the total is altered", () => {
    const keys = gen();
    const store = {
      goals: [
        {
          goal_id: "goal_001",
          user_id: "usr",
          objective: "Launch under $50",
          budget: 50,
          currency: "USD",
          created_at: "2026-11-10T00:00:00.000Z",
        } satisfies Goal,
      ],
      mandates: [
        {
          mandate_id: "mand_001",
          goal_id: "goal_001",
          max_total_spend: 50,
          auto_approve_limit: 10,
          approved_merchants: ["merchant_001"],
          allowed_categories: ["api_credits"],
          expires_at: "2026-11-17T00:00:00.000Z",
          status: "active",
          signed_at: "2026-11-10T00:00:00.000Z",
          public_key: keys.publicKeyPem,
          signature: "x",
        } satisfies Mandate,
      ],
      payments: [
        {
          payment_id: "pay_001",
          plan_id: "plan_001",
          step_id: "step_001",
          goal_id: "goal_001",
          mandate_id: "mand_001",
          merchant_id: "merchant_001",
          merchant_name: "DevTools AI",
          rail: "x402_usdc",
          amount: 8,
          currency: "USD",
          status: "settled",
          approval: "auto",
          created_at: "2026-11-10T00:00:00.000Z",
          updated_at: "2026-11-10T00:00:00.000Z",
        } satisfies Payment,
      ],
      verifications: [],
      receipts: [],
      events: [],
      approvals: [],
      merchants: [],
      contracts: [],
      evidence: [],
      plans: [],
      settings: { kill_switch: false, signing: keys },
    } as StoreData;

    appendEvent(store, "payment.x402.simulated", "paid", { goal_id: "goal_001", payment_id: "pay_001" });
    const receipt = buildReceipt(store, "goal_001");
    expect(receipt.total_spent).toBe(8);
    expect(receipt.remaining_budget).toBe(42);
    expect(verifyReceiptSignature(receipt)).toBe(true);

    const tampered: Receipt = { ...receipt, total_spent: 80 };
    expect(verifyReceiptSignature(tampered)).toBe(false);
  });
});
