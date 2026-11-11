import { describe, expect, it } from "vitest";
import { generateEd25519Pem } from "@/lib/crypto";
import {
  createPaymentLink,
  disablePaymentLinksForKillSwitch,
  evaluatePaymentLink,
  revokePaymentLink,
  syncPaymentLinkStatus,
} from "@/lib/pay-links";
import { settlementTimeline } from "@/lib/settlement";
import type { Mandate, Payment, PaymentLink, StoreData } from "@/lib/types";

const now = new Date("2026-11-11T03:00:00.000Z");

function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    mandate_id: "mand_link",
    goal_id: "goal_link",
    title: "Startup tools under $50",
    max_total_spend: 50,
    auto_approve_limit: 10,
    per_tx_limit: 10,
    approval_threshold: 10,
    approved_merchants: ["merchant_001"],
    allowed_categories: ["api_credits"],
    allow_recurring: false,
    minimum_balance: 0,
    currency: "USD",
    expires_at: "2026-11-18T00:00:00.000Z",
    status: "active",
    signed_at: "2026-11-11T00:00:00.000Z",
    public_key: "test",
    signature: "test",
    ...overrides,
  };
}

function store(overrides: Partial<StoreData> = {}): StoreData {
  return {
    goals: [],
    mandates: [mandate()],
    plans: [],
    payments: [],
    verifications: [],
    receipts: [],
    events: [],
    approvals: [],
    merchants: [],
    contracts: [],
    evidence: [],
    reservations: [],
    payment_links: [],
    settings: { kill_switch: false, signing: generateEd25519Pem() },
    ...overrides,
  } as StoreData;
}

function link(s: StoreData, overrides: Partial<Parameters<typeof createPaymentLink>[1]> = {}): PaymentLink {
  return createPaymentLink(s, {
    mandate_id: "mand_link",
    amount_cap: 10,
    use_type: "single",
    expires_at: "2026-11-18T00:00:00.000Z",
    ...overrides,
  });
}

describe("mandate payment links", () => {
  it("blocks a payment after the link has expired", () => {
    const s = store();
    const created = link(s, { expires_at: "2026-11-10T12:00:00.000Z" });
    const result = evaluatePaymentLink(s, created, 8, now);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("expired");
    expect(created.status).toBe("expired");
    expect(s.events.some((e) => e.type === "pay_link.expired")).toBe(true);
  });

  it("blocks a payment after the link is revoked", () => {
    const s = store();
    const created = link(s);
    revokePaymentLink(s, created.link_id);
    const result = evaluatePaymentLink(s, created, 8, now);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("revoked");
    expect(created.status).toBe("revoked");
    expect(s.events.some((e) => e.type === "pay_link.revoked")).toBe(true);
    const allowed = evaluatePaymentLink(store({ settings: s.settings, mandates: s.mandates, payment_links: [] }), link(store({ settings: s.settings, mandates: s.mandates })), 8, now);
    expect(allowed.ok).toBe(true);
  });

  it("blocks a payment when the kill switch is on and auto-disables active links", () => {
    const s = store();
    const created = link(s);
    expect(evaluatePaymentLink(s, created, 8, now).ok).toBe(true);

    s.settings.kill_switch = true;
    const disabled = disablePaymentLinksForKillSwitch(s);
    expect(disabled).toHaveLength(1);
    expect(created.status).toBe("disabled");
    expect(created.disabled_reason).toBe("kill_switch");

    const result = evaluatePaymentLink(s, created, 8, now);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("kill_switch");
    expect(s.events.some((e) => e.type === "pay_link.disabled")).toBe(true);
  });

  it("enforces the link amount cap before policy or checkout", () => {
    const s = store();
    const created = link(s, { amount_cap: 10 });
    const over = evaluatePaymentLink(s, created, 10.01, now);
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.code).toBe("cap_exceeded");
    expect(over.message).toMatch(/10\.01|exceeds/i);

    const atCap = evaluatePaymentLink(s, created, 10, now);
    expect(atCap.ok).toBe(true);
  });

  it("records a created event on the hash-chained audit log", () => {
    const s = store();
    const created = link(s);
    expect(created.signature).toBeTruthy();
    expect(s.events.some((e) => e.type === "pay_link.created" && e.payload.link_id === created.link_id)).toBe(true);
    expect(s.events.at(-1)?.hash).toBeTruthy();
  });
});

describe("settlement timeline", () => {
  it("marks mock settlement steps as simulated and uses real Braintree statuses when present", () => {
    const mockPayment = {
      payment_id: "pay_mock",
      status: "captured",
      rail: "paypal_sandbox",
      paypal: { mode: "mock", authorization_id: "AUTH-1", capture_id: "CAP-1" },
      amount: 8,
      currency: "USD",
      updated_at: "2026-11-11T03:10:00.000Z",
    } as Payment;

    const mockSteps = settlementTimeline({
      payment: mockPayment,
      verifications: [
        {
          verification_id: "ver_1",
          payment_id: "pay_mock",
          contract_id: "c1",
          status: "passed",
          checks: [],
          created_at: "2026-11-11T03:09:00.000Z",
        },
      ],
      events: [],
    });
    const mockSettled = mockSteps.find((s) => s.id === "settled");
    const mockSubmit = mockSteps.find((s) => s.id === "submitted_for_settlement");
    expect(mockSubmit?.state).toBe("complete");
    expect(mockSubmit?.simulated).toBe(true);
    expect(mockSettled?.simulated).toBe(true);
    expect(mockSettled?.detail).toMatch(/simulated/i);

    const btPayment = {
      payment_id: "pay_bt",
      status: "captured",
      rail: "braintree_sandbox",
      braintree: {
        mode: "sandbox",
        authorization_id: "bt_auth",
        capture_id: "bt_cap",
        status: "submitted_for_settlement",
      },
      amount: 8,
      currency: "USD",
      updated_at: "2026-11-11T03:10:00.000Z",
    } as Payment;
    const btSteps = settlementTimeline({
      payment: btPayment,
      verifications: [
        {
          verification_id: "ver_2",
          payment_id: "pay_bt",
          contract_id: "c1",
          status: "passed",
          checks: [],
          created_at: "2026-11-11T03:09:00.000Z",
        },
      ],
      events: [],
    });
    const submitted = btSteps.find((s) => s.id === "submitted_for_settlement");
    const settled = btSteps.find((s) => s.id === "settled");
    expect(submitted?.state).toBe("complete");
    expect(submitted?.simulated).toBe(false);
    expect(submitted?.source).toBe("braintree");
    expect(settled?.state).toBe("current");
    expect(settled?.simulated).toBe(false);
    expect(settled?.detail).toMatch(/submitted_for_settlement/i);
  });
});

// keep sync helper referenced so typings stay honest if the module surface changes
void syncPaymentLinkStatus;
