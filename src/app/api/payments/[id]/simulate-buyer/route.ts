import { completePaymentAfterBuyer } from "@/lib/engine";
import { fail, ok } from "@/lib/http";
import { paymentMode } from "@/lib/payment-mode";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const payment = await updateStore(async (store) => {
      const payment = store.payments.find((p) => p.payment_id === id);
      if (!payment) throw new Error("Payment not found");
      if (payment.status !== "awaiting_buyer") {
        throw new Error(`Payment is ${payment.status}, expected awaiting_buyer`);
      }
      if (paymentMode() !== "mock" && payment.paypal?.mode !== "mock") {
        throw new Error(
          "simulate-buyer is only available in mock payment mode. Use Braintree Drop-in or the PayPal approve link when sandbox credentials are configured.",
        );
      }
      return completePaymentAfterBuyer(store, payment.payment_id);
    });
    return ok({ payment });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "simulate failed", 400);
  }
}
