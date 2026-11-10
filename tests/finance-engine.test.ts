import { describe, expect, it } from "vitest";
import { assessAffordability, assessFromFinance, availableToSpend, monthlyCashFlow, netWorth } from "@/lib/finance-engine";
import { seedFinance, SEED_EMERGENCY_BUFFER, SEED_NEXT_INCOME_AMOUNT, SEED_NEXT_INCOME_AT } from "@/lib/finance-seed";
import { recordPriceChange } from "@/lib/subscriptions";
import { isMaterialShift, raisedThisYear } from "@/lib/subscription-metrics";
import { LAPTOP_INR } from "@/lib/finance-constants";
import type { ManagedSubscription } from "@/lib/types";

const finance = seedFinance();

function base(amount: number, overrides: Record<string, unknown> = {}) {
  return {
    asOf: finance.profile.as_of,
    accounts: finance.accounts,
    bills: finance.bills,
    emergencyBuffer: SEED_EMERGENCY_BUFFER,
    goals: finance.savings_goals,
    nextIncomeAt: SEED_NEXT_INCOME_AT,
    nextIncomeAmount: SEED_NEXT_INCOME_AMOUNT,
    amount,
    cheaperAlternativeAmount: 48990,
    cheaperAlternativeSku: "nova_air_48990",
    ...overrides,
  };
}

describe("deterministic affordability engine", () => {
  it("computes available-to-spend as balances - bills before next income - buffer - goal contributions", () => {
    const available = availableToSpend({
      accounts: finance.accounts,
      bills: finance.bills,
      emergencyBuffer: SEED_EMERGENCY_BUFFER,
      goals: finance.savings_goals,
      nextIncomeAt: SEED_NEXT_INCOME_AT,
    });
    // 82,400 + 125,000 - 47,698 - 80,000 - 25,000 = 54,702
    expect(available).toBe(54702);
  });

  it("marks a purchase within available-to-spend as AFFORDABLE", () => {
    const r = assessAffordability(base(40000));
    expect(r.verdict).toBe("AFFORDABLE");
    expect(r.safe_spending_limit).toBe(54702);
    expect(r.available_to_spend).toBe(54702);
  });

  it("marks the ₹65,000 laptop as AFFORDABLE_WITH_TRADEOFFS", () => {
    const r = assessAffordability(base(LAPTOP_INR, { requestLabel: "NovaBook 14 laptop" }));
    expect(r.verdict).toBe("AFFORDABLE_WITH_TRADEOFFS");
    expect(r.request_amount).toBe(65000);
    expect(r.available_to_spend).toBe(54702);
    expect(r.goal_impacts.length).toBeGreaterThan(0);
    expect(r.fx.usd).toBe(783.13);
    expect(r.alternatives.some((a) => a.kind === "cheaper")).toBe(true);
    expect(r.alternatives.some((a) => a.kind === "wait")).toBe(true);
  });

  it("marks a purchase that would miss upcoming bills as NOT_RECOMMENDED", () => {
    const r = assessAffordability(base(200000));
    expect(r.verdict).toBe("NOT_RECOMMENDED");
    expect(r.reasons.join(" ")).toMatch(/bills/i);
  });

  it("marks a purchase that would dip into the emergency buffer as NOT_RECOMMENDED", () => {
    // bill-safe = 207400-47698 = 159702, buffer-safe = 79702
    const r = assessAffordability(base(100000));
    expect(r.verdict).toBe("NOT_RECOMMENDED");
    expect(r.reasons.join(" ")).toMatch(/emergency/i);
  });

  it("rejects a zero or negative amount", () => {
    expect(assessAffordability(base(0)).verdict).toBe("NOT_RECOMMENDED");
    expect(assessAffordability(base(-10)).verdict).toBe("NOT_RECOMMENDED");
  });

  it("treats an amount exactly equal to available-to-spend as AFFORDABLE", () => {
    const r = assessAffordability(base(54702));
    expect(r.verdict).toBe("AFFORDABLE");
  });
});

describe("subscription price history helpers", () => {
  it("flags a shift of 10% or more as material", () => {
    expect(isMaterialShift(12, 16)).toBe(true);
    expect(isMaterialShift(10, 10.9)).toBe(false);
    expect(isMaterialShift(10, 11)).toBe(true);
  });

  it("counts raises this year after recording a detected change", () => {
    const sub = {
      amount: 12,
      currency: "USD",
      price_history: [],
    } as unknown as ManagedSubscription;
    recordPriceChange(null, sub, 16, "detected", "2026-11-10T00:00:00.000Z");
    expect(sub.price_history[0].material).toBe(true);
    expect(raisedThisYear(sub, 2026)).toBe(1);
    expect(sub.amount).toBe(12); // recordPriceChange does not mutate amount
  });
});

describe("cash flow", () => {
  it("excludes transfers from income and expenses and reports net worth", () => {
    const november = monthlyCashFlow(finance, "2026-11");
    const october = monthlyCashFlow(finance, "2026-10");
    expect(november.month).toBe("2026-11");
    // Salary lands on the 30th; the demo clock is 10 Nov 2026, so November income is still 0.
    expect(november.income).toBe(0);
    expect(november.expenses).toBeGreaterThan(0);
    expect(october.income).toBe(120000);
    expect(november.net).toBe(Math.round((november.income - november.expenses) * 100) / 100);
    expect(november.net_worth).toBe(netWorth(finance.accounts));
    expect(november.net_worth).toBe(207400);
  });

  it("feeds cash flow into the affordability result", () => {
    const r = assessFromFinance(finance, 40000);
    expect(r.cash_flow?.net_worth).toBe(207400);
    expect(r.verdict).toBe("AFFORDABLE");
  });
});
