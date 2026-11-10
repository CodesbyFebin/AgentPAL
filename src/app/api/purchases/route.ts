import { proposePaymentIntent } from "@/lib/ai-tools";
import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ sku?: string; accept_tradeoffs?: boolean; idempotency_key?: string }>(req);
  if (!body.sku) return fail("sku is required");
  try {
    const result = await updateStore(async (store) => {
      if (body.idempotency_key) {
        const existing = store.payments.find(
          (p) =>
            p.idempotency_key === body.idempotency_key &&
            !["denied", "failed", "voided", "refunded"].includes(p.status),
        );
        if (existing) return { deduped: true as const, payment: existing };
      }
      return proposePaymentIntent(store, body.sku!, Boolean(body.accept_tradeoffs));
    });
    return ok(result, 201);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "purchase failed", 400);
  }
}
