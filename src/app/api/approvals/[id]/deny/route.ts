import { appendEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { nowIso } from "@/lib/ids";
import { releaseReservation } from "@/lib/reservations";
import { updateStore } from "@/lib/store";
import { cancelManagedSubscription } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const result = await updateStore(async (store) => {
      const approval = store.approvals.find((a) => a.approval_id === id);
      if (!approval) throw new Error("Approval not found");
      if (approval.status !== "pending") throw new Error("Approval is already resolved");
      approval.status = "denied";
      approval.resolved_at = nowIso();
      if (approval.kind === "renewal" && approval.subscription_id) {
        const cancelled = await cancelManagedSubscription(
          store,
          approval.subscription_id,
          "Human declined the renewal. Subscription cancelled via PayPal and status verified.",
        );
        appendEvent(store, "approval.denied", `Human declined the ${approval.merchant_name} renewal and cancelled it.`, {
          approval_id: approval.approval_id,
          subscription_id: approval.subscription_id,
          review_id: approval.review_id,
          verified_status: cancelled.paypal_verified_status,
        });
        return { approval, cancelled };
      }
      const payment = store.payments.find((p) => p.payment_id === approval.payment_id);
      if (payment) {
        payment.status = "denied";
        payment.updated_at = nowIso();
        releaseReservation(store, payment.payment_id);
      }
      appendEvent(store, "approval.denied", `Human denied ${approval.merchant_name}`, {
        goal_id: approval.goal_id,
        approval_id: approval.approval_id,
        payment_id: approval.payment_id,
      });
      return { approval };
    });
    return ok(result);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "deny failed", 400);
  }
}
