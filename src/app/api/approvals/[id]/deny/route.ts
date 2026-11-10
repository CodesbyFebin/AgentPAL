import { appendEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { nowIso } from "@/lib/ids";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const approval = await updateStore((store) => {
      const approval = store.approvals.find((a) => a.approval_id === id);
      if (!approval) throw new Error("Approval not found");
      approval.status = "denied";
      approval.resolved_at = nowIso();
      const payment = store.payments.find((p) => p.payment_id === approval.payment_id);
      if (payment) {
        payment.status = "denied";
        payment.updated_at = nowIso();
      }
      appendEvent(store, "approval.denied", `Human denied ${approval.merchant_name}`, {
        goal_id: approval.goal_id,
        approval_id: approval.approval_id,
        payment_id: approval.payment_id,
      });
      return approval;
    });
    return ok({ approval });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "deny failed", 400);
  }
}
