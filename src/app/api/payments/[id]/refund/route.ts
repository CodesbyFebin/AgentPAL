import { draftEvidence } from "@/lib/evidence";
import { appendEvent } from "@/lib/events";
import { readJson } from "@/lib/http";
import { withIdempotency } from "@/lib/idempotency";
import { guardedRefund } from "@/lib/refunds";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Full (default) or partial refund through AgentPaL Guard (kill switch, reason, refundable cap). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson<{ amount?: number; reason?: string }>(req);
  return withIdempotency(req, `payments.refund:${id}`, body, async () => {
    const result = await updateStore(async (store) => {
      const refund = await guardedRefund(store, {
        payment_id: id,
        amount: body.amount,
        reason: body.reason || "Refund requested by the owner in AgentPaL",
        idempotency_key: req.headers.get("idempotency-key") || undefined,
      });
      if (refund.status !== "COMPLETED") return { refund };
      const payment = store.payments.find((p) => p.payment_id === id)!;
      const verification = store.verifications.find((v) => v.payment_id === id);
      const evidence = await draftEvidence(payment, verification);
      store.evidence.push(evidence);
      appendEvent(store, "evidence.drafted", `Refund evidence drafted (${evidence.source})`, {
        goal_id: payment.goal_id,
        payment_id: payment.payment_id,
        evidence_id: evidence.evidence_id,
      });
      return { refund, payment, evidence };
    });
    const status = result.refund.status === "COMPLETED" ? 200 : result.refund.status === "BLOCKED" ? 422 : 502;
    return { status, body: result.refund.status === "COMPLETED" ? result : { ...result, error: result.refund.block_reason } };
  });
}
