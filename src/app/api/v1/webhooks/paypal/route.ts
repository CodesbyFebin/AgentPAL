import { completePaypalAfterBuyer } from "@/lib/engine";
import { fail, ok, readJson } from "@/lib/http";
import { nowIso } from "@/lib/ids";
import { verifyWebhookSignature, webhookHeadersFrom } from "@/lib/paypal";
import { evaluateRenewal } from "@/lib/subscriptions";
import { appendEvent } from "@/lib/events";
import { paypalMode, updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const headers = webhookHeadersFrom(req);
  const event = await readJson<{ id?: string; event_type?: string; resource?: Record<string, unknown> }>(req);
  const demoReplay = req.headers.get("x-moneymate-demo-replay") === "1";

  try {
    const result = await updateStore(async (store) => {
      if (event.id && store.webhook_receipts.some((r) => r.event_id === event.id)) {
        return { deduped: true, event_id: event.id };
      }

      const verification = await verifyWebhookSignature(headers, event);
      const webhookIdSet = Boolean(process.env.PAYPAL_WEBHOOK_ID);
      if (webhookIdSet && !verification.ok) {
        store.webhook_receipts.push({
          event_id: event.id || "unknown",
          event_type: event.event_type || "unknown",
          verified: false,
          verification: "failed",
          processed_at: nowIso(),
        });
        throw new Error("PayPal webhook signature verification failed");
      }
      if (!webhookIdSet && paypalMode() !== "mock" && !demoReplay) {
        throw new Error("PAYPAL_WEBHOOK_ID is not set; refusing to process an unverified live/sandbox webhook (pass x-moneymate-demo-replay: 1 only for a labelled demo replay).");
      }

      const method = webhookIdSet && verification.ok ? "paypal" : paypalMode() === "mock" ? "skipped_mock" : "skipped_no_webhook_id";
      store.webhook_receipts.push({
        event_id: event.id || `evt_${Date.now()}`,
        event_type: event.event_type || "unknown",
        verified: method === "paypal",
        verification: method,
        processed_at: nowIso(),
      });
      appendEvent(store, "webhook.received", `PayPal webhook ${event.event_type || "unknown"} (${method}). A verified webhook is not proof of product delivery — outcome verification is a separate evidence check.`, {
        event_id: event.id,
        event_type: event.event_type,
        verification: method,
      });

      const resource = event.resource || {};
      const customId = String(resource.custom_id || resource.customId || "");
      const resourceId = String(resource.id || "");

      if (event.event_type === "CHECKOUT.ORDER.APPROVED" || event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        const payment =
          store.payments.find((p) => p.payment_id === customId) ||
          store.payments.find((p) => p.paypal?.order_id === resourceId || p.paypal?.capture_id === resourceId);
        if (payment && payment.status === "awaiting_buyer") {
          await completePaypalAfterBuyer(store, payment.payment_id, payment.paypal?.order_id);
        }
      }

      if (event.event_type === "BILLING.SUBSCRIPTION.UPDATED" || event.event_type === "PAYMENT.SALE.COMPLETED") {
        const sub =
          store.subscriptions.find((s) => s.subscription_id === customId) ||
          store.subscriptions.find((s) => s.paypal_subscription_id === resourceId);
        if (sub) {
          const amount = Number(
            (resource.billing_info as { last_payment?: { amount?: { value?: string } } } | undefined)?.last_payment
              ?.amount?.value ?? sub.amount,
          );
          evaluateRenewal(store, sub, amount);
        }
      }

      return { accepted: true, verification: method, event_type: event.event_type };
    });
    return ok(result);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "webhook failed", 400);
  }
}
