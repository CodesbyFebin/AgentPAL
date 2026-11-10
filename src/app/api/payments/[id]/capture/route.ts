import { fail, ok } from "@/lib/http";
import { captureReservedPayment } from "@/lib/payment-provider";
import { appendEvent } from "@/lib/events";
import { nowIso } from "@/lib/ids";
import { applyCapturedPurchase } from "@/lib/finance-apply";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const payment = await updateStore(async (store) => {
      const payment = store.payments.find((p) => p.payment_id === id);
      if (!payment) throw new Error("Payment not found");
      const verification = store.verifications.find((v) => v.payment_id === id);
      if (!verification || verification.status !== "passed") {
        throw new Error("Capture is only allowed after outcome verification passes");
      }
      const authorizationId = payment.braintree?.authorization_id || payment.paypal?.authorization_id;
      if (!authorizationId) throw new Error("No authorization to capture");
      const cap = await captureReservedPayment(authorizationId, payment.rail);
      if (payment.rail === "braintree_sandbox" && payment.braintree) {
        payment.braintree.capture_id = cap.capture_id;
        payment.braintree.status = cap.status || "submitted_for_settlement";
      } else if (payment.paypal) {
        payment.paypal.capture_id = cap.capture_id;
      }
      payment.status = "captured";
      payment.updated_at = nowIso();
      appendEvent(store, payment.rail === "braintree_sandbox" ? "payment.braintree.captured" : "payment.paypal.captured", `Capture ${cap.capture_id}`, {
        goal_id: payment.goal_id,
        payment_id: payment.payment_id,
        capture_id: cap.capture_id,
      });
      applyCapturedPurchase(store, payment);
      return payment;
    });
    return ok({ payment });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "capture failed", 400);
  }
}
