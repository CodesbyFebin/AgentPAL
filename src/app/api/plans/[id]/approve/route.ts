import { appendEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const plan = await updateStore((store) => {
      const plan = store.plans.find((p) => p.plan_id === id);
      if (!plan) throw new Error("Plan not found");
      plan.status = "approved";
      appendEvent(store, "plan.approved", `Plan ${plan.plan_id} approved by the user`, {
        goal_id: plan.goal_id,
        plan_id: plan.plan_id,
      });
      return plan;
    });
    return ok({ plan });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "failed", 400);
  }
}
