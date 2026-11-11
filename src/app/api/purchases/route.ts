import { proposePaymentIntent } from "@/lib/ai-tools";
import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ sku?: string; approval_id?: string; idempotency_key?: string; [k: string]: unknown }>(req);
  if (!body.sku) return fail("sku is required");
  // The old boolean is gone: trade-offs are accepted only via a server-side approval record created by
  // the user's click (POST /api/purchases/approvals). A client flag cannot stand in for that.
  if ("accept_tradeoffs" in body) {
    return fail("accept_tradeoffs is not accepted. Create a trade-off approval with POST /api/purchases/approvals and pass approval_id.", 400);
  }
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
      return proposePaymentIntent(store, body.sku!, {
        approvalId: typeof body.approval_id === "string" ? body.approval_id : undefined,
      });
    });
    return ok(result, 201);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "purchase failed", 400);
  }
}
