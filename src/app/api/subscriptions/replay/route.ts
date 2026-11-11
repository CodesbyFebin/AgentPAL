import { fail, ok, readJson } from "@/lib/http";
import { demoRenewalWebhook, evaluateRenewal } from "@/lib/subscriptions";
import { appendEvent } from "@/lib/events";
import { nowIso } from "@/lib/ids";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Labelled demo control: sandbox billing does not fire on cue, so judges can replay a renewal webhook. */
export async function POST(req: Request) {
  const body = await readJson<{ subscription_id?: string; proposed_amount?: number }>(req);
  try {
    const result = await updateStore((store) => {
      const sub =
        store.subscriptions.find((s) => s.subscription_id === body.subscription_id) ||
        store.subscriptions.find((s) => s.merchant_id === "merchant_clouddraw");
      if (!sub) throw new Error("No managed subscription to replay");
      const amount = body.proposed_amount === undefined ? sub.amount : body.proposed_amount;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        throw new Error("proposed_amount must be a finite number greater than zero");
      }
      const webhook = demoRenewalWebhook(sub, amount);
      store.webhook_receipts.push({
        event_id: webhook.id,
        event_type: webhook.event_type,
        verified: false,
        verification: "skipped_mock",
        processed_at: nowIso(),
      });
      appendEvent(store, "webhook.replayed", "Labelled replay of a PayPal subscription webhook (sandbox billing does not fire on cue).", {
        event_id: webhook.id,
        event_type: webhook.event_type,
        subscription_id: sub.subscription_id,
      });
      const review = evaluateRenewal(store, sub, amount);
      return { webhook, review, subscription: sub };
    });
    return ok(result);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "replay failed", 400);
  }
}
