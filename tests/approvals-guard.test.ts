import { describe, expect, it } from "vitest";
import { approvablePending, isBlockedOrMalicious, skippedBlocked } from "@/lib/approvals-guard";
import type { Approval } from "@/lib/types";

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    approval_id: "appr_1",
    payment_id: "pay_1",
    step_id: "step_1",
    goal_id: "goal_1",
    merchant_name: "DevTools AI",
    amount: 12,
    currency: "USD",
    reason: "Amount exceeds the per-transaction limit. AgentPaL Guard requires approval.",
    status: "pending",
    created_at: "2026-11-10T12:00:00.000Z",
    kind: "payment",
    ...overrides,
  };
}

describe("Approve-all guard", () => {
  it("keeps ordinary ask-first and renewal approvals", () => {
    const ask = approval();
    const renewal = approval({
      approval_id: "appr_2",
      kind: "renewal",
      merchant_name: "CloudDraw",
      reason: "Price rose above the matched-renewal rule. Step-up approval required.",
    });
    expect(approvablePending([ask, renewal])).toEqual([ask, renewal]);
    expect(skippedBlocked([ask, renewal])).toEqual([]);
  });

  it("skips blocked and malicious pending items and never includes them in approve-all", () => {
    const ok = approval({ approval_id: "appr_ok" });
    const deniedAlready = approval({ approval_id: "appr_denied", status: "denied" });
    const injection = approval({
      approval_id: "appr_inj",
      merchant_name: "TotallyLegit Gadgets",
      reason: "DENY: merchant listing text is untrusted data and matched “ignore spending limits”. No PayPal call is made.",
    });
    const evil = approval({
      approval_id: "appr_evil",
      merchant_name: "Evil Merchant",
      reason: "Awaiting a human look.",
    });
    const bait = approval({
      approval_id: "appr_bait",
      merchant_name: "Bait Shop",
      payment_id: "pay_bait",
      reason: "First-time merchant, please confirm.",
    });
    const failedPay = approval({
      approval_id: "appr_fail",
      payment_id: "pay_fail",
      reason: "Over the per-tx limit.",
    });

    const list = [ok, deniedAlready, injection, evil, bait, failedPay];
    const opts = {
      merchants: [
        { merchant_id: "merchant_bait", name: "Bait Shop", injection_bait: true },
        { merchant_id: "merchant_001", name: "DevTools AI", injection_bait: false },
      ],
      payments: [
        { payment_id: "pay_1", status: "awaiting_approval" as const, merchant_id: "merchant_001" },
        { payment_id: "pay_bait", status: "awaiting_approval" as const, merchant_id: "merchant_bait" },
        { payment_id: "pay_fail", status: "denied" as const, merchant_id: "merchant_001" },
      ],
    };

    expect(approvablePending(list, opts).map((a) => a.approval_id)).toEqual(["appr_ok"]);
    expect(skippedBlocked(list, opts).map((a) => a.approval_id).sort()).toEqual(
      ["appr_bait", "appr_evil", "appr_fail", "appr_inj"].sort(),
    );
    expect(isBlockedOrMalicious(ok, opts)).toBe(false);
    expect(isBlockedOrMalicious(injection, opts)).toBe(true);
  });

  it("ignores already-approved rows", () => {
    const done = approval({ status: "approved" });
    expect(approvablePending([done])).toEqual([]);
  });
});
