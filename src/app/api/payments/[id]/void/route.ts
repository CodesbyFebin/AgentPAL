import { fail, ok } from "@/lib/http";
import { voidReservedPayment } from "@/lib/payment-provider";
import { appendEvent } from "@/lib/events";
import { nowIso } from "@/lib/ids";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const payment = await updateStore(async (store) => {
      const payment = store.payments.find((p) => p.payment_id === id);
      const authorizationId = payment?.braintree?.authorization_id || payment?.paypal?.authorization_id;
      if (!payment || !authorizationId) throw new Error("No authorization to void");
      await voidReservedPayment(authorizationId, payment.rail);
      payment.status = "voided";
      payment.updated_at = nowIso();
      if (payment.braintree) payment.braintree.status = "voided";
      appendEvent(store, payment.rail === "braintree_sandbox" ? "payment.braintree.voided" : "payment.paypal.voided", `Authorization voided`, {
        goal_id: payment.goal_id,
        payment_id: payment.payment_id,
        authorization_id: authorizationId,
      });
      return payment;
    });
    return ok({ payment });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "void failed", 400);
  }
}
