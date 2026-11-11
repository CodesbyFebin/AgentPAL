import { completePaymentAfterBuyer } from "@/lib/engine";
import { readJson } from "@/lib/http";
import { withIdempotency } from "@/lib/idempotency";
import { redactSecrets } from "@/lib/ai-permissions";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson<{ order_id?: string; payment_method_nonce?: string; nonce?: string }>(req);
  return withIdempotency(req, `payments.authorize:${id}`, body, async () => {
    try {
      const payment = await updateStore((store) =>
        completePaymentAfterBuyer(store, id, {
          orderId: body.order_id,
          nonce: body.payment_method_nonce || body.nonce,
        }),
      );
      return { status: 200, body: { payment } };
    } catch (err) {
      return { status: 400, body: { error: redactSecrets(err instanceof Error ? err.message : "authorize failed") } };
    }
  });
}
