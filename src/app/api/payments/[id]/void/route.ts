import { fail, ok } from "@/lib/http";
import { voidAuthorization } from "@/lib/paypal";
import { appendEvent } from "@/lib/events";
import { nowIso } from "@/lib/ids";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const payment = await updateStore(async (store) => {
      const payment = store.payments.find((p) => p.payment_id === id);
      if (!payment?.paypal?.authorization_id) throw new Error("No authorization to void");
      await voidAuthorization(payment.paypal.authorization_id);
      payment.status = "voided";
      payment.updated_at = nowIso();
      appendEvent(store, "payment.paypal.voided", `PayPal authorization voided`, {
        goal_id: payment.goal_id,
        payment_id: payment.payment_id,
        authorization_id: payment.paypal.authorization_id,
      });
      return payment;
    });
    return ok({ payment });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "void failed", 400);
  }
}
