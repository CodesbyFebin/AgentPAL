/**
 * Mandate templates the USER signs with an explicit click. AI / toolkit code never calls these:
 * authority is only ever created by a human action routed through POST /api/mandates/sign.
 */
import { PIXELFORGE_ID } from "./catalog";
import { createSignedMandate } from "./engine";
import { id, nowIso } from "./ids";
import type { Mandate, StoreData } from "./types";

export const COACH_TOOLS_GOAL_ID = "coach_paypal_tools";

export type MandateTemplate = "personal_inr" | "coach_paypal_tools";

export function signMandateTemplate(store: StoreData, template: MandateTemplate): Mandate {
  if (template === "coach_paypal_tools") {
    const existing = store.mandates.find((m) => m.goal_id === COACH_TOOLS_GOAL_ID && m.status === "active");
    if (existing) return existing;
    return createSignedMandate(store, {
      goal_id: COACH_TOOLS_GOAL_ID,
      title: "Coach PayPal tools (agent-toolkit)",
      max_total_spend: 100,
      per_tx_limit: 50,
      approved_merchants: ["merchant_001", "merchant_002"],
      allowed_categories: ["api_credits", "domain"],
      currency: "USD",
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      space: "My Money",
    });
  }
  const existing = store.mandates.find(
    (m) => m.status === "active" && m.currency === "INR" && m.approved_merchants.includes(PIXELFORGE_ID),
  );
  if (existing) return existing;
  let goal = store.goals.find((g) => g.objective === "Personal INR purchases");
  if (!goal) {
    goal = { goal_id: id("goal"), user_id: store.finance.profile.user_id, objective: "Personal INR purchases", budget: 80000, currency: "INR", created_at: nowIso() };
    store.goals.push(goal);
  }
  return createSignedMandate(store, {
    goal_id: goal.goal_id,
    title: "Personal INR purchases",
    max_total_spend: 80000,
    per_tx_limit: 10000,
    approved_merchants: [PIXELFORGE_ID],
    allowed_categories: ["electronics", "accessories"],
    currency: "INR",
    minimum_balance: store.finance.profile.emergency_buffer,
  });
}
