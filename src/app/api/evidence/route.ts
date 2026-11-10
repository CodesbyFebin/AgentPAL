import { draftEvidence } from "@/lib/evidence";
import { appendEvent } from "@/lib/events";
import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const evidence = await updateStore((s) => s.evidence);
  return ok({ evidence });
}

export async function POST(req: Request) {
  const body = await readJson<{ payment_id?: string }>(req);
  if (!body.payment_id) return fail("payment_id is required");
  try {
    const evidence = await updateStore(async (store) => {
      const payment = store.payments.find((p) => p.payment_id === body.payment_id);
      if (!payment) throw new Error("Payment not found");
      const verification = store.verifications.find((v) => v.payment_id === payment.payment_id);
      const evidence = await draftEvidence(payment, verification);
      store.evidence.push(evidence);
      appendEvent(store, "evidence.drafted", `Evidence drafted (${evidence.source})`, {
        goal_id: payment.goal_id,
        payment_id: payment.payment_id,
        evidence_id: evidence.evidence_id,
      });
      return evidence;
    });
    return ok({ evidence }, 201);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "evidence failed", 400);
  }
}
