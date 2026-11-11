import { fail, ok, readJson } from "@/lib/http";
import { createButtonsOrder } from "@/lib/paypal-buttons";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** createOrder for the official PayPal JS Buttons. Amount comes from the Guard reservation, never the browser. */
export async function POST(req: Request) {
  const body = await readJson<{ payment_id?: string }>(req);
  if (!body.payment_id) return fail("payment_id is required");
  try {
    const result = await updateStore((store) => createButtonsOrder(store, body.payment_id!));
    return ok(result);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "create order failed", 400);
  }
}
