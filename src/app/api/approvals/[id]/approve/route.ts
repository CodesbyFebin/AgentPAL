import { executeStep } from "@/lib/engine";
import { appendEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { nowIso } from "@/lib/ids";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const result = await updateStore(async (store) => {
      const approval = store.approvals.find((a) => a.approval_id === id);
      if (!approval) throw new Error("Approval not found");
      if (approval.status !== "pending") throw new Error("Approval is already resolved");
      if (store.settings.kill_switch) throw new Error("Kill switch is on");
      approval.status = "approved";
      approval.resolved_at = nowIso();
      appendEvent(store, "approval.granted", `Human approved ${approval.merchant_name}`, {
        goal_id: approval.goal_id,
        approval_id: approval.approval_id,
        payment_id: approval.payment_id,
      });
      const payment = store.payments.find((p) => p.payment_id === approval.payment_id);
      const plan = store.plans.find((p) => p.steps.some((s) => s.step_id === approval.step_id));
      const step = plan?.steps.find((s) => s.step_id === approval.step_id);
      if (!plan || !step || !payment) throw new Error("Payment or plan not found");
      return executeStep(store, plan, step, { afterHumanApproval: true });
    });
    return ok(result);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "approve failed", 400);
  }
}
