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
    max_total_spend?: number;
    auto_approve_limit?: number;
    approved_merchants?: string[];
    allowed_categories?: string[];
    expires_at?: string;
  }>(req);
  if (!body.goal_id) return fail("goal_id is required");
  const mandate = await updateStore((store) => {
    const goal = store.goals.find((g) => g.goal_id === body.goal_id);
    if (!goal) throw new Error("Goal not found");
    return createSignedMandate(store, {
      goal_id: goal.goal_id,
      max_total_spend: Number(body.max_total_spend ?? goal.budget),
      auto_approve_limit: Number(body.auto_approve_limit ?? 10),
      approved_merchants: body.approved_merchants ?? ["merchant_001", "merchant_002"],
      allowed_categories: body.allowed_categories ?? ["api_credits", "domain"],
      expires_at: body.expires_at,
    });
  });
  return ok({ mandate }, 201);
}
