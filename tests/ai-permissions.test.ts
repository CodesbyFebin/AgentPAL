import { emptyStore } from "@/lib/store";
import { describe, expect, it } from "vitest";
import { authorizeTool, levelForTool, parseToolArgs } from "@/lib/ai-permissions";
import { runCoachTool } from "@/lib/ai-tools";
import { SEED_MERCHANTS } from "@/lib/catalog";
import { seedFinance } from "@/lib/finance-seed";
import type { StoreData } from "@/lib/types";

function store(): StoreData {
  return {
    ...emptyStore(),
    goals: [],
    mandates: [],
    plans: [],
    payments: [],
    verifications: [],
    receipts: [],
    events: [],
    approvals: [],
    merchants: structuredClone(SEED_MERCHANTS),
    contracts: [],
    evidence: [],
    finance: seedFinance(),
    idempotency: [],
    webhook_receipts: [],
    subscriptions: [],
    renewal_reviews: [],
    reservations: [],
    ai_calls: [],
    subscription_price_history: [],
    recurring_rules: [],
    merchant_directory: [],
    categories: [],
    ai_tool_logs: [],
    financial_snapshots: [],
    settings: { kill_switch: false, signing: { publicKeyPem: "pub", privateKeyPem: "PRIV-TEST-KEY" } },
  };
}

describe("AI permission levels", () => {
  it("classifies read tools as L1 and propose_payment as L2", () => {
    expect(levelForTool("get_accounts")).toBe("L1");
    expect(levelForTool("check_affordability")).toBe("L1");
    expect(levelForTool("propose_payment")).toBe("L2");
    expect(authorizeTool("propose_payment").allowed).toBe(true);
  });

  it("forbids L3 execute tools so the AI cannot capture, refund, or cancel", () => {
    const s = store();
    for (const name of ["capture_payment", "refund_payment", "execute_step", "cancel_subscription", "sign_mandate", "void_authorization", "create_paypal_order"]) {
      expect(levelForTool(name)).toBe("L3");
      expect(authorizeTool(name).allowed).toBe(false);
      const result = runCoachTool(s, name, { payment_id: "pay_x" }) as { error: string; executed: boolean; level: string };
      expect(result.executed).toBe(false);
      expect(result.level).toBe("L3");
      expect(result.error).toMatch(/forbidden/i);
    }
    expect(s.payments).toHaveLength(0);
    expect(s.ai_tool_logs.every((l) => l.ok === false && l.level === "L3")).toBe(true);
  });

  it("rejects invalid tool arguments via zod and does not dispatch", () => {
    expect(parseToolArgs("check_affordability", { amount: "free" }).ok).toBe(false);
    const s = store();
    const result = runCoachTool(s, "check_affordability", { amount: "free" } as unknown as Record<string, unknown>) as { error: string };
    expect(result.error).toBeTruthy();
    expect(s.ai_calls[0].ok).toBe(false);
  });

  it("allows L1 affordability reads", () => {
    const s = store();
    const result = runCoachTool(s, "check_affordability", { amount: 65000, label: "laptop" }) as { verdict: string };
    expect(result.verdict).toBe("AFFORDABLE_WITH_TRADEOFFS");
    expect(s.ai_calls[0].level).toBe("L1");
    expect(s.ai_calls[0].ok).toBe(true);
  });
});
