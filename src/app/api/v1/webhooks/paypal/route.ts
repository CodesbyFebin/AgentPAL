import { NextResponse } from "next/server";
import { z } from "zod";
import { appendEvent } from "@/lib/events";
import { completePaypalAfterBuyer } from "@/lib/engine";
import { webhookHeadersFrom } from "@/lib/paypal";
import { evaluateRenewal } from "@/lib/subscriptions";
import { updateStore } from "@/lib/store";
import { intakePayPalWebhook } from "@/lib/webhook-security";
import { fail, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.string().min(1).max(128),
  event_type: z.string().min(1).max(128),
  resource: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export async function POST(req: Request) {
  const parsed = schema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail("Invalid PayPal webhook payload.");
  const event = parsed.data;

  try {
    const result = await updateStore(async (store) => {
      const headers = webhookHeadersFrom(req);
      const outcome = await intakePayPalWebhook(store, headers, event);
      if (outcome.body.result !== "verified") return outcome;
      const resource = event.resource || {};
      const customId = resource.custom_id || resource.customId;
      const resourceId = resource.id;

      try {
        if (event.event_type === "CHECKOUT.ORDER.APPROVED" && typeof resourceId === "string") {
          const payment = store.payments.find((p) => p.paypal?.order_id === resourceId && p.status === "awaiting_buyer");
          if (payment) await completePaypalAfterBuyer(store, payment.payment_id, resourceId);
        }

        if (event.event_type === "BILLING.SUBSCRIPTION.UPDATED" || event.event_type === "PAYMENT.SALE.COMPLETED") {
          const sub = store.subscriptions.find((s) =>
            (typeof customId === "string" && s.subscription_id === customId) ||
            (typeof resourceId === "string" && s.paypal_subscription_id === resourceId));
          if (sub) {
            const amount = Number((resource.billing_info as { last_payment?: { amount?: { value?: string } } } | undefined)?.last_payment?.amount?.value ?? sub.amount);
            if (Number.isFinite(amount) && amount > 0) evaluateRenewal(store, sub, amount);
          }
        }
      } catch {
        store.webhook_transmissions = store.webhook_transmissions.filter((entry) => entry.transmission_id !== headers.transmissionId);
        store.webhook_receipts = store.webhook_receipts.filter((entry) => entry.event_id !== event.id || !entry.verified);
        appendEvent(store, "webhook.processing_failed", "Verified PayPal event could not be processed.", { event_id: event.id });
        return { status: 502, body: { ok: false, result: "processing_failed" } };
      }
      return outcome;
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    return fail("PayPal webhook processing failed.", 502);
  }
}
