import { withIdempotency } from "@/lib/idempotency";
import { redactSecrets } from "@/lib/ai-permissions";
import { proposePaymentIntent } from "@/lib/ai-tools";
import { fail, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ sku?: string; approval_id?: string; idempotency_key?: string; [k: string]: unknown }>(req);
  const sku = body?.sku;
  if (typeof sku !== "string" || !sku) return fail("sku is required");
  if ("accept_tradeoffs" in body) {
    return fail("accept_tradeoffs is not accepted. Create a trade-off approval with POST /api/purchases/approvals and pass approval_id.", 400);
  }

  return withIdempotency(req, "purchases.propose", body, async () => {
    try {
      const result = await updateStore(async (store) => {
        if (body.idempotency_key) {
          const existing = store.payments.find((p) => p.idempotency_key === body.idempotency_key &&
            !["denied", "failed", "voided", "refunded"].includes(p.status));
          if (existing) return { deduped: true as const, payment: existing };
        }
        return proposePaymentIntent(store, sku, {
          approvalId: typeof body.approval_id === "string" ? body.approval_id : undefined,
        });
      });
      return { status: 201, body: result };
    } catch (err) {
      return { status: 400, body: { error: redactSecrets(err instanceof Error ? err.message : "purchase failed") } };
    }
  });
}
