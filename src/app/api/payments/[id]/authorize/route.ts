import { completePaymentAfterBuyer } from "@/lib/engine";
import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson<{ order_id?: string; payment_method_nonce?: string; nonce?: string }>(req);
  try {
    const payment = await updateStore((store) =>
      completePaymentAfterBuyer(store, id, {
        orderId: body.order_id,
        nonce: body.payment_method_nonce || body.nonce,
      }),
    );
    return ok({ payment });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "authorize failed", 400);
  }
}
