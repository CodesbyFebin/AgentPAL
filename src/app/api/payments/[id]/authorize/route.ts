import { type NextRequest } from "next/server";
import { OWNER_SESSION, ownerSessionRequired, verifyOwnerSession } from "@/lib/owner-session";
import { completePaymentAfterBuyer } from "@/lib/engine";
import { readJson } from "@/lib/http";
import { withIdempotency } from "@/lib/idempotency";
import { redactSecrets } from "@/lib/ai-permissions";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson<{ order_id?: string; payment_method_nonce?: string; nonce?: string }>(req);
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid checkout response." }, { status: 400 });
  const owner = !ownerSessionRequired() || await verifyOwnerSession(req.cookies.get(OWNER_SESSION)?.value);
  return withIdempotency(req, `payments.authorize:${id}:${owner ? "owner" : "buyer"}`, body, async () => {
    try {
      const payment = await updateStore((store) => {
        if (!owner) {
          const reserved = store.payments.find((item) => item.payment_id === id);
          const validBuyer = reserved && (Boolean(reserved.payment_link_id) ||
            Boolean(body?.order_id && body.order_id === reserved.paypal?.order_id));
          if (!validBuyer) return null;
        }
        return completePaymentAfterBuyer(store, id, {
          orderId: body.order_id,
          nonce: body.payment_method_nonce || body.nonce,
        });
      });
      if (!payment) return { status: 403, body: { error: "A valid buyer return or owner session is required." } };
      return { status: 200, body: { payment: owner ? payment : { status: payment.status, payment_id: payment.payment_id } } };
    } catch (err) {
      return { status: 400, body: { error: redactSecrets(err instanceof Error ? err.message : "authorize failed") } };
    }
  });
}
