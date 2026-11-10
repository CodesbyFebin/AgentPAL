import { executeStep } from "@/lib/engine";
import { fail, ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const result = await updateStore(async (store) => {
      const plan = store.plans.find((p) => p.steps.some((s) => s.step_id === id));
      const step = plan?.steps.find((s) => s.step_id === id);
      if (!plan || !step) throw new Error("Step not found");
      if (plan.status !== "approved") throw new Error("Plan must be approved before a step can execute");
      return executeStep(store, plan, step);
    });
    return ok(result);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "execute failed", 400);
  }
}
