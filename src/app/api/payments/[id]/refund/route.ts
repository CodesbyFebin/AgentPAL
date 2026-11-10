import { refundPayment } from "@/lib/engine";
import { draftEvidence } from "@/lib/evidence";
import { appendEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const result = await updateStore(async (store) => {
      const payment = await refundPayment(store, id);
      const verification = store.verifications.find((v) => v.payment_id === id);
      const evidence = await draftEvidence(payment, verification);
      store.evidence.push(evidence);
      appendEvent(store, "evidence.drafted", `Refund evidence drafted (${evidence.source})`, {
        goal_id: payment.goal_id,
        payment_id: payment.payment_id,
        evidence_id: evidence.evidence_id,
      });
      return { payment, evidence };
    });
    return ok(result);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "refund failed", 400);
  }
}
