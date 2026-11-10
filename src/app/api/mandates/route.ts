import { createSignedMandate } from "@/lib/engine";
import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const mandates = await updateStore((s) => s.mandates);
  return ok({ mandates });
}

export async function POST(req: Request) {
  const body = await readJson<{
    goal_id?: string;
    title?: string;
    max_total_spend?: number;
    auto_approve_limit?: number;
    per_tx_limit?: number;
    approval_threshold?: number;
    approved_merchants?: string[];
    allowed_categories?: string[];
    allow_recurring?: boolean;
    minimum_balance?: number;
    currency?: "USD" | "INR" | "USDC";
    expires_at?: string;
  }>(req);
  if (!body.goal_id) return fail("goal_id is required");
  const mandate = await updateStore((store) => {
    const goal = store.goals.find((g) => g.goal_id === body.goal_id);
    if (!goal) throw new Error("Goal not found");
    return createSignedMandate(store, {
      goal_id: goal.goal_id,
      title: body.title,
      max_total_spend: Number(body.max_total_spend ?? goal.budget),
      auto_approve_limit: Number(body.per_tx_limit ?? body.auto_approve_limit ?? 10),
      per_tx_limit: body.per_tx_limit ?? body.auto_approve_limit,
      approval_threshold: body.approval_threshold,
      approved_merchants: body.approved_merchants ?? ["merchant_001", "merchant_002"],
      allowed_categories: body.allowed_categories ?? ["api_credits", "domain"],
      allow_recurring: body.allow_recurring,
      minimum_balance: body.minimum_balance,
      currency: body.currency ?? goal.currency,
      expires_at: body.expires_at,
    });
  });
  return ok({ mandate }, 201);
}
