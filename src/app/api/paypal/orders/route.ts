import { readJson } from "@/lib/http";
import { withIdempotency } from "@/lib/idempotency";
import { redactSecrets } from "@/lib/ai-permissions";
import { createButtonsOrder } from "@/lib/paypal-buttons";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** createOrder for the official PayPal JS Buttons. Amount comes from the Guard reservation, never the browser. */
export async function POST(req: Request) {
  const body = await readJson<{ payment_id?: string }>(req);
  if (!body.payment_id) return Response.json({ error: "payment_id is required" }, { status: 400 });
  return withIdempotency(req, "paypal.orders", body, async () => {
    try {
      const result = await updateStore((store) => createButtonsOrder(store, body.payment_id!));
      return { status: 200, body: result };
    } catch (err) {
      return { status: 400, body: { error: redactSecrets(err instanceof Error ? err.message : "create order failed") } };
    }
  });
}
