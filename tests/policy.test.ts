import { describe, expect, it } from "vitest";
import { SEED_MERCHANTS } from "@/lib/catalog";
import { detectPromptInjection, evaluatePolicy } from "@/lib/policy";
import type { Mandate } from "@/lib/types";

const now = new Date("2026-11-10T12:00:00.000Z");

function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    mandate_id: "mand_test",
    goal_id: "goal_test",
    max_total_spend: 50,
    auto_approve_limit: 10,
    approved_merchants: ["merchant_001", "merchant_002"],
    allowed_categories: ["api_credits", "domain"],
    expires_at: "2026-11-17T00:00:00.000Z",
    status: "active",
    signed_at: "2026-11-10T00:00:00.000Z",
    public_key: "test",
    signature: "test",
    ...overrides,
  };
}

const api = SEED_MERCHANTS[0];
const domain = SEED_MERCHANTS[1];
const evil = SEED_MERCHANTS[2];

describe("policy engine", () => {
  it("auto-allows an $8 allowlisted API credit purchase under the limit", () => {
    const d = evaluatePolicy({
      mandate: mandate(),
      merchant: api,
      amount: 8,
      category: "api_credits",
      recurring: false,
      remainingBudget: 50,
      killSwitch: false,
      firstTimeMerchant: true,
      now,
    });
    expect(d.decision).toBe("allow");
    expect(d.reason.toLowerCase()).toContain("allowed");
    expect(d.checks.every((c) => c.passed)).toBe(true);
  });

  it("requires approval when a purchase exceeds the auto-approve limit", () => {
    const d = evaluatePolicy({
      mandate: mandate(),
      merchant: domain,
      amount: 12,
      category: "domain",
      recurring: false,
      remainingBudget: 42,
      killSwitch: false,
      firstTimeMerchant: true,
      now,
    });
    expect(d.decision).toBe("needs-approval");
    expect(d.reason).toMatch(/auto-approve limit/i);
    expect(d.checks.find((c) => c.code === "auto_approve_limit")?.passed).toBe(false);
  });

  it("blocks when the amount exceeds remaining budget", () => {
    const d = evaluatePolicy({
      mandate: mandate(),
      merchant: domain,
      amount: 12,
      category: "domain",
      recurring: false,
      remainingBudget: 5,
      killSwitch: false,
      firstTimeMerchant: false,
      now,
    });
    expect(d.decision).toBe("block");
    expect(d.reason).toMatch(/remaining budget/i);
  });

  it("blocks an expired or inactive mandate", () => {
    const expired = evaluatePolicy({
      mandate: mandate({ expires_at: "2026-11-01T00:00:00.000Z" }),
      merchant: api,
      amount: 8,
      category: "api_credits",
      recurring: false,
      remainingBudget: 50,
      killSwitch: false,
      firstTimeMerchant: false,
      now,
    });
    expect(expired.decision).toBe("block");
    expect(expired.reason).toMatch(/expired/i);

    const revoked = evaluatePolicy({
      mandate: mandate({ status: "revoked" }),
      merchant: api,
      amount: 8,
      category: "api_credits",
      recurring: false,
      remainingBudget: 50,
      killSwitch: false,
      firstTimeMerchant: false,
      now,
    });
    expect(revoked.decision).toBe("block");
    expect(revoked.reason).toMatch(/revoked/i);
  });

  it("blocks everything when the kill switch is on", () => {
    const d = evaluatePolicy({
      mandate: mandate(),
      merchant: api,
      amount: 8,
      category: "api_credits",
      recurring: false,
      remainingBudget: 50,
      killSwitch: true,
      firstTimeMerchant: false,
      now,
    });
    expect(d.decision).toBe("block");
    expect(d.reason).toMatch(/kill switch/i);
  });

  it("blocks a merchant whose listing tries to inject policy instructions", () => {
    const detected = detectPromptInjection([evil.description]);
    expect(detected.detected).toBe(true);

    const d = evaluatePolicy({
      mandate: mandate({ approved_merchants: ["merchant_001", "merchant_002", "merchant_evil"] }),
      merchant: evil,
      amount: 49,
      category: "misc",
      recurring: false,
      remainingBudget: 50,
      killSwitch: false,
      firstTimeMerchant: true,
      now,
    });
    expect(d.decision).toBe("block");
    expect(d.reason.toLowerCase()).toMatch(/injection/);
    expect(d.checks.find((c) => c.code === "prompt_injection")?.passed).toBe(false);
  });

  it("blocks merchants off the allowlist and disallowed categories", () => {
    const allow = evaluatePolicy({
      mandate: mandate(),
      merchant: evil,
      amount: 5,
      category: "api_credits",
      recurring: false,
      remainingBudget: 50,
      killSwitch: false,
      firstTimeMerchant: true,
      now,
    });
    expect(allow.decision).toBe("block");
    expect(allow.checks.find((c) => c.code === "allowlist")?.passed).toBe(false);

    const cat = evaluatePolicy({
      mandate: mandate(),
      merchant: api,
      amount: 8,
      category: "misc",
      recurring: false,
      remainingBudget: 50,
      killSwitch: false,
      firstTimeMerchant: false,
      now,
    });
    expect(cat.decision).toBe("block");
    expect(cat.checks.find((c) => c.code === "category")?.passed).toBe(false);
  });

  it("requires approval for recurring charges even under the auto-approve limit", () => {
    const d = evaluatePolicy({
      mandate: mandate(),
      merchant: api,
      amount: 8,
      category: "api_credits",
      recurring: true,
      remainingBudget: 50,
      killSwitch: false,
      firstTimeMerchant: false,
      now,
    });
    expect(d.decision).toBe("needs-approval");
    expect(d.checks.find((c) => c.code === "recurring")?.passed).toBe(false);
  });
});
