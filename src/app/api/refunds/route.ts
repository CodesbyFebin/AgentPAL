import { fail, ok, readJson } from "@/lib/http";
import { withIdempotency } from "@/lib/idempotency";
import { guardedRefund, refundableUsd, refundedUsd, settledUsd } from "@/lib/refunds";
import { readStore, updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = readStore();
  return ok({
    refunds: [...store.refunds].reverse(),
    refundable: store.payments
      .filter((p) => ["captured", "settled", "refunded"].includes(p.status))
      .map((p) => ({
        payment_id: p.payment_id,
        merchant_name: p.merchant_name,
        status: p.status,
        rail: p.rail,
        mode: p.braintree?.mode || p.paypal?.mode || "mock",
        settled_usd: settledUsd(p),
        refunded_usd: refundedUsd(store, p.payment_id),
        refundable_usd: refundableUsd(store, p),
      })),
  });
}

/** Guarded full/partial refund. Send an Idempotency-Key header to make retries safe. */
export async function POST(req: Request) {
  const body = await readJson<{ payment_id?: string; amount?: number; reason?: string }>(req);
  if (!body.payment_id) return fail("payment_id is required");
  return withIdempotency(req, "refunds", body, async () => {
    const rec = await updateStore((store) =>
      guardedRefund(store, {
        payment_id: body.payment_id!,
        amount: body.amount,
        reason: body.reason || "",
        idempotency_key: req.headers.get("idempotency-key") || undefined,
      }),
    );
    return { status: rec.status === "COMPLETED" ? 201 : rec.status === "BLOCKED" ? 422 : 502, body: { refund: rec } };
  });
}
