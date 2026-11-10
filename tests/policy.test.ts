import { describe, expect, it } from "vitest";
import { SEED_MERCHANTS } from "@/lib/catalog";
import { detectPromptInjection, evaluatePolicy } from "@/lib/policy";
import type { Mandate } from "@/lib/types";

const now = new Date("2026-11-10T12:00:00.000Z");

function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    mandate_id: "mand_test",
    goal_id: "goal_test",
    title: "Startup tools under $50",
    max_total_spend: 50,
    auto_approve_limit: 10,
    per_tx_limit: 10,
    approval_threshold: 10,
    approved_merchants: ["merchant_001", "merchant_002"],
    allowed_categories: ["api_credits", "domain"],
    allow_recurring: false,
    minimum_balance: 0,
    currency: "USD",
    expires_at: "2026-11-17T00:00:00.000Z",
    status: "active",
    signed_at: "2026-11-10T00:00:00.000Z",
    public_key: "test",
    signature: "test",
    ...overrides,
  };
}

const api = SEED_MERCHANTS.find((m) => m.merchant_id === "merchant_001")!;
const domain = SEED_MERCHANTS.find((m) => m.merchant_id === "merchant_002")!;
const evil = SEED_MERCHANTS.find((m) => m.merchant_id === "merchant_evil")!;

const base = {
  recurring: false,
  mandateSpend: 0,
  killSwitch: false,
  now,
};

describe("MeshPaL policy engine — decision order", () => {
  it("ALLOWs an $8 allowlisted API credit purchase under the per-tx limit", () => {
    const d = evaluatePolicy({ ...base, mandate: mandate(), merchant: api, amount: 8, category: "api_credits", currency: "USD" });
    expect(d.decision).toBe("ALLOW");
    expect(d.reason).toMatch(/ALLOW/);
    expect(d.checks.every((c) => c.passed)).toBe(true);
  });

  it("REQUIRE_APPROVAL when amount exceeds the per-tx limit", () => {
    const d = evaluatePolicy({ ...base, mandate: mandate(), merchant: domain, amount: 12, category: "domain", currency: "USD" });
    expect(d.decision).toBe("REQUIRE_APPROVAL");
    expect(d.checks.find((c) => c.code === "per_tx_limit")?.passed).toBe(false);
  });

  it("DENYs when mandateSpend + amount exceeds the total limit (wins over per-tx approval)", () => {
    const d = evaluatePolicy({
      ...base,
      mandate: mandate(),
      merchant: domain,
      amount: 12,
      category: "domain",
      currency: "USD",
      mandateSpend: 45,
    });
    expect(d.decision).toBe("DENY");
    expect(d.checks.find((c) => c.code === "total_limit")?.passed).toBe(false);
  });

  it("DENYs an expired or revoked mandate", () => {
    const expired = evaluatePolicy({
      ...base,
      mandate: mandate({ expires_at: "2026-11-01T00:00:00.000Z" }),
      merchant: api,
      amount: 8,
      category: "api_credits",
      currency: "USD",
    });
    expect(expired.decision).toBe("DENY");
    expect(expired.reason).toMatch(/expired/i);

    const revoked = evaluatePolicy({
      ...base,
      mandate: mandate({ status: "revoked" }),
      merchant: api,
      amount: 8,
      category: "api_credits",
      currency: "USD",
    });
    expect(revoked.decision).toBe("DENY");
    expect(revoked.reason).toMatch(/revoked/i);
  });

  it("DENYs everything when the kill switch is on", () => {
    const d = evaluatePolicy({
      ...base,
      mandate: mandate(),
      merchant: api,
      amount: 8,
      category: "api_credits",
      currency: "USD",
      killSwitch: true,
    });
    expect(d.decision).toBe("DENY");
    expect(d.reason).toMatch(/kill switch/i);
  });

  it("DENYs amount <= 0", () => {
    const d = evaluatePolicy({ ...base, mandate: mandate(), merchant: api, amount: 0, category: "api_credits", currency: "USD" });
    expect(d.decision).toBe("DENY");
    expect(d.checks.find((c) => c.code === "amount")?.passed).toBe(false);
  });

  it("DENYs a merchant whose listing tries to inject policy instructions, even if allowlisted", () => {
    const detected = detectPromptInjection([evil.description]);
    expect(detected.detected).toBe(true);
    const d = evaluatePolicy({
      ...base,
      mandate: mandate({ approved_merchants: ["merchant_001", "merchant_002", "merchant_evil"], allowed_categories: ["api_credits", "domain", "misc"] }),
      merchant: evil,
      amount: 49,
      category: "misc",
      currency: "USD",
    });
    expect(d.decision).toBe("DENY");
    expect(d.reason.toLowerCase()).toMatch(/injection|untrusted/);
    expect(d.checks.find((c) => c.code === "prompt_injection")?.passed).toBe(false);
  });

  it("DENYs merchants off the allowlist and disallowed categories", () => {
    const allow = evaluatePolicy({
      ...base,
      mandate: mandate(),
      merchant: evil,
      amount: 5,
      category: "api_credits",
      currency: "USD",
    });
    expect(allow.decision).toBe("DENY");
    expect(allow.checks.find((c) => c.code === "allowlist")?.passed).toBe(false);

    const cat = evaluatePolicy({
      ...base,
      mandate: mandate(),
      merchant: api,
      amount: 8,
      category: "misc",
      currency: "USD",
    });
    expect(cat.decision).toBe("DENY");
    expect(cat.checks.find((c) => c.code === "category")?.passed).toBe(false);
  });

  it("REQUIRE_APPROVAL for recurring charges when allowRecurring is off", () => {
    const d = evaluatePolicy({
      ...base,
      mandate: mandate(),
      merchant: api,
      amount: 8,
      category: "api_credits",
      currency: "USD",
      recurring: true,
    });
    expect(d.decision).toBe("REQUIRE_APPROVAL");
    expect(d.checks.find((c) => c.code === "recurring")?.passed).toBe(false);
  });

  it("ALLOWs recurring charges when allowRecurring is on and the amount is in limits", () => {
    const d = evaluatePolicy({
      ...base,
      mandate: mandate({ allow_recurring: true }),
      merchant: api,
      amount: 8,
      category: "api_credits",
      currency: "USD",
      recurring: true,
    });
    expect(d.decision).toBe("ALLOW");
    expect(d.checks.find((c) => c.code === "recurring")?.passed).toBe(true);
  });

  it("REQUIRE_APPROVAL on a currency mismatch", () => {
    const d = evaluatePolicy({
      ...base,
      mandate: mandate({ currency: "USD" }),
      merchant: api,
      amount: 8,
      category: "api_credits",
      currency: "INR",
    });
    expect(d.decision).toBe("REQUIRE_APPROVAL");
    expect(d.checks.find((c) => c.code === "currency")?.passed).toBe(false);
  });

  it("REQUIRE_APPROVAL when projectedBalance - amount is under minimumBalance", () => {
    const d = evaluatePolicy({
      ...base,
      mandate: mandate({ minimum_balance: 80_000, currency: "INR", per_tx_limit: 100_000, auto_approve_limit: 100_000, approval_threshold: 100_000, max_total_spend: 200_000 }),
      merchant: api,
      amount: 65_000,
      category: "api_credits",
      currency: "INR",
      projectedBalance: 100_000,
    });
    expect(d.decision).toBe("REQUIRE_APPROVAL");
    expect(d.checks.find((c) => c.code === "minimum_balance")?.passed).toBe(false);
  });
});
